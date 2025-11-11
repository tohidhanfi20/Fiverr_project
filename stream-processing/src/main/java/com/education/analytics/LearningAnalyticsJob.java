package com.education.analytics;

import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.AggregateFunction;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.api.java.tuple.Tuple4;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.connector.kafka.sink.KafkaSink;
import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.windowing.assigners.TumblingEventTimeWindows;
import org.apache.flink.streaming.api.windowing.time.Time;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

public class LearningAnalyticsJob {
    
    public static void main(String[] args) throws Exception {
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        env.enableCheckpointing(60000); // 1 minute checkpoints
        
        ObjectMapper objectMapper = new ObjectMapper();
        
        // Kafka source - consume learning events
        KafkaSource<String> source = KafkaSource.<String>builder()
            .setBootstrapServers(System.getenv().getOrDefault("KAFKA_BROKERS", "localhost:9092"))
            .setTopics("learning-events")
            .setGroupId("flink-analytics-group")
            .setStartingOffsets(OffsetsInitializer.latest())
            .setValueOnlyDeserializer(new SimpleStringSchema())
            .build();
        
        DataStream<String> events = env.fromSource(source, WatermarkStrategy.noWatermarks(), "Kafka Source");
        
        // Parse JSON and extract userId, timestamp
        DataStream<LearningEvent> parsedEvents = events
            .map(eventJson -> {
                JsonNode json = objectMapper.readTree(eventJson);
                LearningEvent event = new LearningEvent();
                event.userId = json.has("userId") ? json.get("userId").asText() : null;
                event.courseId = json.has("courseId") ? json.get("courseId").asText() : null;
                event.eventType = json.has("eventType") ? json.get("eventType").asText() : null;
                event.timestamp = json.has("timestamp") ? Instant.parse(json.get("timestamp").asText()) : Instant.now();
                return event;
            })
            .returns(Types.POJO(LearningEvent.class));
        
        // Assign watermarks
        DataStream<LearningEvent> withWatermarks = parsedEvents
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<LearningEvent>forMonotonousTimestamps()
                    .withTimestampAssigner((event, timestamp) -> event.timestamp.toEpochMilli())
            );

        // Windowed aggregation: count unique users per 1-minute window
        DataStream<AnalyticsResult> aggregated = withWatermarks
            .keyBy(event -> event.courseId != null ? event.courseId : "unknown")
            .window(TumblingEventTimeWindows.of(Time.minutes(1)))
            .aggregate(new UniqueUserAggregator())
            .map(windowResult -> {
                AnalyticsResult result = new AnalyticsResult();
                result.windowStart = windowResult.f0.toString();
                result.windowEnd = windowResult.f1.toString();
                result.uniqueUsers = windowResult.f2;
                result.totalEvents = windowResult.f3;
                return result;
            })
            .returns(Types.POJO(AnalyticsResult.class));
        
        // Serialize to JSON and publish to results topic
        DataStream<String> resultsJson = aggregated
            .map(result -> objectMapper.writeValueAsString(result))
            .returns(Types.STRING);
        
        KafkaSink<String> sink = KafkaSink.<String>builder()
            .setBootstrapServers(System.getenv().getOrDefault("KAFKA_BROKERS", "localhost:9092"))
            .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                .setTopic("analytics-results")
                .setValueSerializationSchema(new SimpleStringSchema())
                .build())
            .build();
        
        resultsJson.sinkTo(sink);
        
        env.execute("Learning Analytics Job");
    }
    
    // Aggregate function to count unique users
    public static class UniqueUserAggregator implements AggregateFunction<
            LearningEvent,
            Tuple4<Set<String>, Long, Instant, Instant>,
            Tuple4<Instant, Instant, Integer, Long>> {
        
        @Override
        public Tuple4<Set<String>, Long, Instant, Instant> createAccumulator() {
            return Tuple4.of(new HashSet<>(), 0L, Instant.now(), Instant.now());
        }
        
        @Override
        public Tuple4<Set<String>, Long, Instant, Instant> add(LearningEvent value, Tuple4<Set<String>, Long, Instant, Instant> accumulator) {
            if (value.userId != null) {
                accumulator.f0.add(value.userId);
            }
            Instant timestamp = value.timestamp;
            Instant windowStart = accumulator.f2.isBefore(timestamp) ? accumulator.f2 : timestamp;
            Instant windowEnd = accumulator.f3.isAfter(timestamp) ? accumulator.f3 : timestamp;
            return Tuple4.of(accumulator.f0, accumulator.f1 + 1, windowStart, windowEnd);
        }
        
        @Override
        public Tuple4<Instant, Instant, Integer, Long> getResult(Tuple4<Set<String>, Long, Instant, Instant> accumulator) {
            // Return window start, window end, unique users count, total events
            return Tuple4.of(accumulator.f2, accumulator.f3, accumulator.f0.size(), accumulator.f1);
        }
        
        @Override
        public Tuple4<Set<String>, Long, Instant, Instant> merge(Tuple4<Set<String>, Long, Instant, Instant> a, Tuple4<Set<String>, Long, Instant, Instant> b) {
            a.f0.addAll(b.f0);
            Instant mergedStart = a.f2.isBefore(b.f2) ? a.f2 : b.f2;
            Instant mergedEnd = a.f3.isAfter(b.f3) ? a.f3 : b.f3;
            return Tuple4.of(a.f0, a.f1 + b.f1, mergedStart, mergedEnd);
        }
    }
    
    public static class LearningEvent {
        public String userId;
        public String courseId;
        public String eventType;
        public Instant timestamp;
    }
    
    public static class AnalyticsResult {
        public String windowStart;
        public String windowEnd;
        public int uniqueUsers;
        public long totalEvents;
    }
}


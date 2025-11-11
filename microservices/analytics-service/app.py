from flask import Flask, jsonify, request
from prometheus_client import generate_latest, Counter, Histogram, REGISTRY
from kafka import KafkaConsumer
import psycopg2
from google.cloud import storage
import json
import os
import threading
import logging

app = Flask(__name__)

# Prometheus metrics
http_requests_total = Counter('http_requests_total', 'Total HTTP requests', ['method', 'endpoint', 'status'])
http_request_duration = Histogram('http_request_duration_seconds', 'HTTP request duration', ['method', 'endpoint'])

# Logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database connection (GCP Cloud SQL)
def get_db_connection():
    return psycopg2.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        port=os.getenv('DB_PORT', 5432),
        database=os.getenv('DB_NAME', 'analytics_db'),
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', 'password')
    )

# GCS client
storage_client = storage.Client()
bucket_name = os.getenv('GCS_BUCKET', 'analytics-data')

# Kafka consumer for analytics results
def consume_analytics_results():
    consumer = KafkaConsumer(
        'analytics-results',
        bootstrap_servers=os.getenv('KAFKA_BROKERS', 'localhost:9092').split(','),
        value_deserializer=lambda m: json.loads(m.decode('utf-8')),
        group_id='analytics-service-group'
    )
    
    for message in consumer:
        try:
            result = message.value
            logger.info(f'Received analytics result: {result}')
            
            # Store in Cloud SQL
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO analytics_results (window_start, window_end, unique_users, total_events, created_at) VALUES (%s, %s, %s, %s, NOW())',
                (result.get('windowStart'), result.get('windowEnd'), result.get('uniqueUsers'), result.get('totalEvents'))
            )
            conn.commit()
            cursor.close()
            conn.close()
            
            # Optionally store in GCS
            if os.getenv('STORE_IN_GCS', 'false').lower() == 'true':
                bucket = storage_client.bucket(bucket_name)
                blob = bucket.blob(f"results/{result.get('windowStart')}.json")
                blob.upload_from_string(json.dumps(result))
            
        except Exception as e:
            logger.error(f'Error processing analytics result: {e}')

# Start Kafka consumer in background thread
consumer_thread = threading.Thread(target=consume_analytics_results, daemon=True)
consumer_thread.start()

@app.route('/health')
def health():
    return jsonify({'status': 'healthy', 'service': 'analytics-service'})

@app.route('/metrics')
def metrics():
    return generate_latest(REGISTRY), 200, {'Content-Type': 'text/plain'}

@app.route('/api/analytics/results', methods=['GET'])
def get_analytics_results():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        limit = request.args.get('limit', 100, type=int)
        cursor.execute(
            'SELECT * FROM analytics_results ORDER BY created_at DESC LIMIT %s',
            (limit,)
        )
        
        results = []
        for row in cursor.fetchall():
            results.append({
                'id': row[0],
                'windowStart': row[1],
                'windowEnd': row[2],
                'uniqueUsers': row[3],
                'totalEvents': row[4],
                'createdAt': row[5].isoformat() if row[5] else None
            })
        
        cursor.close()
        conn.close()
        
        http_requests_total.labels(method='GET', endpoint='/api/analytics/results', status=200).inc()
        return jsonify(results)
    except Exception as e:
        logger.error(f'Error getting analytics results: {e}')
        http_requests_total.labels(method='GET', endpoint='/api/analytics/results', status=500).inc()
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/analytics/summary', methods=['GET'])
def get_analytics_summary():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 
                COUNT(*) as total_windows,
                SUM(unique_users) as total_unique_users,
                SUM(total_events) as total_events,
                AVG(unique_users) as avg_users_per_window
            FROM analytics_results
        ''')
        
        row = cursor.fetchone()
        summary = {
            'totalWindows': row[0],
            'totalUniqueUsers': row[1],
            'totalEvents': row[2],
            'avgUsersPerWindow': float(row[3]) if row[3] else 0
        }
        
        cursor.close()
        conn.close()
        
        http_requests_total.labels(method='GET', endpoint='/api/analytics/summary', status=200).inc()
        return jsonify(summary)
    except Exception as e:
        logger.error(f'Error getting analytics summary: {e}')
        http_requests_total.labels(method='GET', endpoint='/api/analytics/summary', status=500).inc()
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    port = int(os.getenv('PORT', 8085))
    app.run(host='0.0.0.0', port=port)


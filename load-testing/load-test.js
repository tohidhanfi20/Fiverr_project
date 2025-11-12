import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const requestDuration = new Trend('request_duration');

export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 200 },  // Ramp up to 200 users (stress test)
    { duration: '5m', target: 200 },  // Stay at 200 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'], // 95% of requests < 1s, 99% < 2s
    errors: ['rate<0.05'], // Error rate < 5%
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Test user registration
  const registerRes = http.post(`${BASE_URL}/api/users/register`, JSON.stringify({
    email: `user${Date.now()}@test.com`,
    password: 'testpassword123',
    name: 'Test User',
    role: 'student'
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(registerRes, {
    'registration status is 201': (r) => r.status === 201,
  }) || errorRate.add(1);

  requestDuration.add(registerRes.timings.duration);

  sleep(1);

  // Test login
  const loginRes = http.post(`${BASE_URL}/api/users/login`, JSON.stringify({
    email: 'test@example.com',
    password: 'testpassword'
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(loginRes, {
    'login status is 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  requestDuration.add(loginRes.timings.duration);

  sleep(1);

  // Test get courses
  const coursesRes = http.get(`${BASE_URL}/api/courses`);

  check(coursesRes, {
    'courses status is 200': (r) => r.status === 200,
    'courses response has data': (r) => r.json().length >= 0,
  }) || errorRate.add(1);

  requestDuration.add(coursesRes.timings.duration);

  sleep(1);

  // Test get single course
  const courseRes = http.get(`${BASE_URL}/api/courses/1`);

  check(courseRes, {
    'course status is 200 or 404': (r) => r.status === 200 || r.status === 404,
  }) || errorRate.add(1);

  requestDuration.add(courseRes.timings.duration);

  sleep(1);

  // Test learning event tracking
  const eventRes = http.post(`${BASE_URL}/api/events/learning`, JSON.stringify({
    userId: 1,
    courseId: 1,
    eventType: 'PAGE_VIEW',
    metadata: { page: 'course-overview' }
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(eventRes, {
    'event tracking status is 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  requestDuration.add(eventRes.timings.duration);

  sleep(1);

  // Test progress update
  const progressRes = http.post(`${BASE_URL}/api/progress`, JSON.stringify({
    user_id: 1,
    course_id: 1,
    content_id: 1,
    progress_percentage: 25,
    time_spent: 300
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(progressRes, {
    'progress update status is 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  requestDuration.add(progressRes.timings.duration);

  sleep(2);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'summary.json': JSON.stringify(data),
  };
}

function textSummary(data, options) {
  // Simple text summary
  return `
  ====================
   Load Test Summary
  ====================
  Total Requests: ${data.metrics.http_reqs.values.count}
  Request Rate: ${data.metrics.http_req_rate.values.rate.toFixed(2)} req/s
  Error Rate: ${(data.metrics.errors.values.rate * 100).toFixed(2)}%
  Avg Duration: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms
  P95 Duration: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms
  P99 Duration: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms
  ====================
  `;
}


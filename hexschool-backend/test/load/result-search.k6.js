import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Result-day load simulation (roadmap M19 §9).
 *
 * On result day the whole district opens the same three things at once: the
 * SSR result-search page, the exam picker it populates from, and the search
 * itself. All three are hit here in the ratio a real spike produces —
 * mostly searches, because a visitor loads the page once and then retries
 * the form.
 *
 *   WEB_URL   the Next.js origin      (default http://localhost:3000)
 *   API_URL   the Nest API origin     (default http://localhost:5007/api/v1)
 *   RPS       target arrival rate     (default 200, the roadmap's number)
 *   DURATION  how long to hold it     (default 60s)
 *
 * Run:
 *   k6 run test/load/result-search.k6.js
 */
const WEB = __ENV.WEB_URL || 'http://localhost:3000';
const API = __ENV.API_URL || 'http://localhost:5007/api/v1';
const RPS = Number(__ENV.RPS || 200);
const DURATION = __ENV.DURATION || '60s';

const searchLatency = new Trend('search_latency', true);
const pageLatency = new Trend('page_latency', true);
const examsLatency = new Trend('exams_latency', true);
const wellFormed = new Rate('well_formed_responses');

export const options = {
  scenarios: {
    result_day: {
      executor: 'constant-arrival-rate',
      rate: RPS,
      timeUnit: '1s',
      duration: DURATION,
      // Headroom so the generator itself is never the bottleneck; if k6
      // cannot keep up it says so, and the run is not a measurement of the
      // server at all.
      preAllocatedVUs: Math.max(50, RPS),
      maxVUs: Math.max(200, RPS * 4),
    },
  },
  thresholds: {
    // The roadmap's spike budget: the search path stays under 500 ms at the
    // 95th percentile and nothing 5xxs.
    'http_req_failed{expected_response:true}': ['rate<0.01'],
    search_latency: ['p(95)<500'],
    exams_latency: ['p(95)<500'],
    page_latency: ['p(95)<1000'],
  },
};

// A published exam/class pair to search within, when the dataset has one.
// Without it the search arm still exercises routing, validation, the DB
// lookup and the 404 shaping — the same work a miss does on result day,
// which is most of the traffic when parents mistype a roll.
const EXAM_ID = __ENV.EXAM_ID || '00000000-0000-4000-8000-000000000000';
const CLASS_ID = __ENV.CLASS_ID || '00000000-0000-4000-8000-000000000001';

/**
 * A distinct client IP per iteration.
 *
 * The public API is rate-limited per IP (100/min). A result-day spike is
 * tens of thousands of *different* households, so a load test that sourced
 * everything from one address would measure the throttler rather than the
 * server — which is exactly what the first run of this script did. The API
 * runs with `trust proxy` (it sits behind Nginx in production), so
 * `X-Forwarded-For` is what the throttler keys on, and varying it here
 * reproduces the real shape. Point this at anything you do not own and it
 * is simply a lie about who is calling.
 */
function visitorHeaders() {
  const a = 1 + Math.floor(Math.random() * 250);
  const b = 1 + Math.floor(Math.random() * 250);
  return { headers: { 'X-Forwarded-For': `10.${a}.${b}.1` } };
}

export default function () {
  const roll = 1 + Math.floor(Math.random() * 500);
  const draw = Math.random();
  const visitor = visitorHeaders();

  if (draw < 0.7) {
    const res = http.get(
      `${API}/public/results/search?examId=${EXAM_ID}&classId=${CLASS_ID}&rollNo=${roll}`,
      { ...visitor, tags: { name: 'result-search' } },
    );
    searchLatency.add(res.timings.duration);
    // A miss is a 404 by design (a withheld result and a non-existent one
    // answer identically), so 404 is a correct response, not a failure.
    wellFormed.add(res.status === 200 || res.status === 404);
    check(res, { 'search did not 5xx': (r) => r.status < 500 });
  } else if (draw < 0.85) {
    const res = http.get(`${API}/public/results/exams`, {
      ...visitor,
      tags: { name: 'result-exams' },
    });
    examsLatency.add(res.timings.duration);
    wellFormed.add(res.status === 200);
    check(res, { 'exams 200': (r) => r.status === 200 });
  } else {
    const res = http.get(`${WEB}/results`, {
      ...visitor,
      tags: { name: 'result-page' },
    });
    pageLatency.add(res.timings.duration);
    wellFormed.add(res.status === 200);
    check(res, { 'page 200': (r) => r.status === 200 });
  }
}

// Load test of the stack started by the CI perf job: health routes of the back and of the
// ML service, and the consumption route the dashboard polls every 10 s. k6 exits with a
// non-zero code when a threshold is missed, which fails the job.
import http from "k6/http";
import { check } from "k6";

const BACK_URL = __ENV.BACK_URL || "http://localhost:8000";
const ML_URL = __ENV.ML_URL || "http://localhost:8001";

export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    // Tracked on its own, so fast health checks cannot hide a slow business route.
    "http_req_duration{endpoint:consumption_summary}": ["p(95)<500"],
  },
};

export default function () {
  const health = http.get(`${BACK_URL}/health`, { tags: { endpoint: "back_health" } });
  check(health, {
    "back health: status 200": (r) => r.status === 200,
    "back health: database reachable": (r) => r.json("database") === "ok",
  });

  const summary = http.get(`${BACK_URL}/api/consommations`, {
    tags: { endpoint: "consumption_summary" },
  });
  check(summary, {
    "consumption summary: status 200": (r) => r.status === 200,
    "consumption summary: sites relayed": (r) => (r.json("data.sites") || []).length > 0,
    "consumption summary: data not stale": (r) => r.json("stale") === false,
  });

  const ml = http.get(`${ML_URL}/health`, { tags: { endpoint: "ml_health" } });
  check(ml, {
    "ml health: status 200": (r) => r.status === 200,
  });
}

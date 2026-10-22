// Test de charge des endpoints /health du back et du service ML (ticket #24).
// La CI échoue si un seuil n'est pas tenu : k6 sort alors avec un code non nul.
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
  },
};

export default function () {
  const back = http.get(`${BACK_URL}/health`);
  check(back, {
    "back : statut 200": (r) => r.status === 200,
    "back : base joignable": (r) => r.json("database") === "ok",
  });

  const ml = http.get(`${ML_URL}/health`);
  check(ml, {
    "ml : statut 200": (r) => r.status === 200,
  });
}

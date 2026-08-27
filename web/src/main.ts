/**
 * P0 smoke entry — proves the toolchain end to end in a browser: the pinned
 * submodule's example is read by the real reader and summarised.
 *
 * The application proper lands in P1; this file is expected to be replaced.
 */
import planText from "../../external/ofplang-schedule/examples/outputs/plate_batch.plan.yaml?raw";
import { readExecutionDocumentText } from "./read";

const doc = readExecutionDocumentText(planText);
const count = (kind: string) => doc.activities.filter((a) => a.kind === kind).length;

const app = document.getElementById("app");
if (app) {
  app.textContent =
    `plate_batch — ${doc.outcome ?? "?"}, makespan ${String(doc.objective?.value ?? "?")} ` +
    `${doc.time?.unit ?? ""}, ${doc.activities.length} activities ` +
    `(${count("processing")} processing, ${count("transport")} transport, ${count("relay")} relay)`;
}

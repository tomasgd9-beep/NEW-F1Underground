// Run by GitHub Actions every 15 minutes (see .github/workflows/job.yml).
import { getDb } from "../src/db";
import { runScheduledJob } from "../src/lib/job";

runScheduledJob(getDb())
  .then((res) => {
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

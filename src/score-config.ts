import slop from "./config.js";

export default { ...slop, rules: { ...slop.rules, "slop/file-metrics": "warn" } };

import { configure } from "@testing-library/dom";

// WASM init (esp. the ~2 MB cel build) can take >1s when several test files
// load engines in parallel. Raise the async-util timeout so `waitFor(ready)`
// is robust under load rather than flaky.
configure({ asyncUtilTimeout: 5000 });

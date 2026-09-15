# Separate sandbox dependency

Milestone 0 intentionally does not start a Judge0 deployment. Later execution integration uses a server-only API endpoint, token, and verified Python language ID.

For local development, use a separately configured execution API or a dedicated disposable Linux VM. A public/demo deployment must isolate the sandbox from the application DB/Redis and credentials. Do not add privileged execution containers or the Docker socket to the main Compose stack.

Before enabling executions, verify the maintained version, current security advisories, authentication, outbound-network prohibition, actual CPU/wall/memory/process/file/output enforcement, response limits, deletion behavior, and Python syntax/memory verdicts. Store observations in the verification report. Never infer safety from a successful hello-world run.

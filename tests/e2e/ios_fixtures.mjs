// The fixtures and examples for the iOS UI test, which cannot run the CLI
// itself: [{ id, link, want }] (want: the CLI's stdout, null for programs
// that use chance or the clock), written to the file named on the command
// line. tools/package_ios.sh e2e runs it for the playground.
import { writeFileSync } from "node:fs";
import { autorunLink, programs, reference } from "../lib/fixtures.mjs";

const list = programs().map((p) => ({ id: p.id, link: autorunLink(p), want: reference(p) }));
writeFileSync(process.argv[2], JSON.stringify(list));
console.log(`${list.length} programs for the iOS fixtures test`);

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("src/aspect-ratios.html");
const outputDirectory = path.resolve("dist");
const output = path.join(outputDirectory, "index.html");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const plannerHtml = await readFile(source, "utf8");
const approvalsHtml = await readFile(path.resolve("src/approvals.html"), "utf8");
const approvalContent = approvalsHtml.match(/<!-- creative-start -->([\s\S]+)<!-- creative-end -->/)?.[1];
if (!approvalContent) throw new Error("Creative workspace template is missing.");
await writeFile(output, plannerHtml.replace("<!-- embed-creative-workspace -->", () => approvalContent));
await copyFile(path.resolve("src/login.html"), path.join(outputDirectory, "login.html"));
await copyFile(path.resolve("src/auth.js"), path.join(outputDirectory, "auth.js"));
await copyFile(path.resolve("src/msal-client.js"), path.join(outputDirectory, "msal-client.js"));
await copyFile(path.resolve("src/account.js"), path.join(outputDirectory, "account.js"));
await copyFile(path.resolve("src/users.html"), path.join(outputDirectory, "users.html"));
await copyFile(path.resolve("src/users.js"), path.join(outputDirectory, "users.js"));
for (const file of ["approvals.html", "approvals.js", "approvals.css"]) {
  await copyFile(path.resolve("src", file), path.join(outputDirectory, file));
}
await copyFile(
  path.resolve("node_modules/@azure/msal-browser/lib/msal-browser.min.js"),
  path.join(outputDirectory, "msal-browser.min.js"),
);
console.log(`Built ${output}`);

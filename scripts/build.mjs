import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("src/aspect-ratios.html");
const outputDirectory = path.resolve("dist");
const output = path.join(outputDirectory, "index.html");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await writeFile(output, await readFile(source));
await copyFile(path.resolve("src/login.html"), path.join(outputDirectory, "login.html"));
await copyFile(path.resolve("src/auth.js"), path.join(outputDirectory, "auth.js"));
await copyFile(path.resolve("src/msal-client.js"), path.join(outputDirectory, "msal-client.js"));
await copyFile(path.resolve("src/account.js"), path.join(outputDirectory, "account.js"));
await copyFile(path.resolve("src/users.html"), path.join(outputDirectory, "users.html"));
await copyFile(path.resolve("src/users.js"), path.join(outputDirectory, "users.js"));
await copyFile(
  path.resolve("node_modules/@azure/msal-browser/lib/msal-browser.min.js"),
  path.join(outputDirectory, "msal-browser.min.js"),
);
console.log(`Built ${output}`);

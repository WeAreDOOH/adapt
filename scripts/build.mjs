import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("src/aspect-ratios.html");
const outputDirectory = path.resolve("dist");
const output = path.join(outputDirectory, "index.html");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await writeFile(output, await readFile(source));
console.log(`Built ${output}`);

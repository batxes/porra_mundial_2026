import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const outputDir = path.join(root, "src", "lib", "generated");

function loadLegacyFile(fileName, key) {
  const context = { window: {} };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, fileName), "utf8");
  vm.runInContext(source, context, { filename: fileName });
  return context.window[key];
}

function writeModule(fileName, variableName, value, importLine = "", typeName = "") {
  const suffix = typeName ? ` as const satisfies ${typeName}` : " as const";
  const body = `${importLine}${importLine ? "\n" : ""}export const ${variableName} = ${JSON.stringify(
    value,
    null,
    2,
  )}${suffix};\n`;
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, fileName), body);
}

const rawData = loadLegacyFile("data.js", "PORRA_DATA");
const rawSchedule = loadLegacyFile("schedule.js", "PORRA_SCHEDULE");

const schedule = rawSchedule.map(([number, date, time, home, away, venue, stage]) => ({
  number,
  date,
  time,
  home,
  away,
  venue,
  stage,
}));

writeModule("data.ts", "porraData", rawData, 'import type { PorraData } from "@/lib/types";', "PorraData");
writeModule("schedule.ts", "porraSchedule", schedule, 'import type { Match } from "@/lib/types";', "readonly Match[]");

console.log(`Generated legacy modules in ${path.relative(root, outputDir)}`);

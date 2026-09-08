import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EmailSender } from "../types";

/** Local development only: EZ4 keeps its local state under `.ez4/`, so mail goes to `.ez4/emails/`. */
export const DEFAULT_EMAIL_FILE_DIRECTORY = ".ez4/emails";

export function createFileSender(options: { directory?: string } = {}): EmailSender {
  const directory = resolve(process.cwd(), options.directory ?? DEFAULT_EMAIL_FILE_DIRECTORY);
  return {
    mode: "file",
    async send(message) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const slug = message.subject.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "email";
      const id = `${stamp}-${slug}-${randomBytes(3).toString("hex")}.eml`;
      const content = [
        `From: ${message.from}`,
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        `Date: ${new Date().toUTCString()}`,
        ...(message.key ? [`X-Receivy-Key: ${message.key}`] : []),
        "",
        message.text,
        "",
      ].join("\n");
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, id), content, { encoding: "utf8", flag: "wx" });
        return { status: "accepted", id };
      } catch {
        return { status: "transient" };
      }
    },
  };
}

import type { Bucket } from "@ez4/storage";

/** Holds the built SPA. `ez4 deploy` syncs `./dist` into it, so `vite build` runs first (the deploy:* scripts do). */
export declare class WebFiles extends Bucket.Service {
  localPath: "./dist";
}

/** Native identifiers are owner configuration; local IDs require deliberate opt-in.
 * Expo passes the static app.json as `config`; extending it (not re-reading the file) keeps
 * app.json as the single static source and satisfies expo-doctor's unused-static-config check. */
module.exports = ({ config } = {}) => {
  const base = config ?? require("./app.json").expo;
  const local = process.env.RECEIVY_LOCAL_NATIVE === "1";
  if (local && (process.env.EAS_BUILD === "true" || process.env.APP_STAGE === "prd" || process.env.EAS_BUILD_PROFILE === "production")) throw new Error("Local native identifiers cannot be used for production or EAS builds.");
  const iosId = local ? "dev.receivy.local" : process.env.RECEIVY_IOS_BUNDLE_IDENTIFIER;
  const androidId = local ? "dev.receivy.local" : process.env.RECEIVY_ANDROID_APPLICATION_ID;
  for (const id of [iosId, androidId]) if (id && !/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*){2,}$/.test(id)) throw new Error("Invalid configured native application identifier.");
  return { ...base, name: local ? "Receivy Local" : base.name,
    ios: { ...base.ios, ...(iosId ? { bundleIdentifier: iosId } : {}), usesAppleSignIn: true },
    android: { ...base.android, ...(androidId ? { package: androidId } : {}) },
    plugins: [...(base.plugins ?? []), "expo-apple-authentication", "expo-dev-client"],
  };
};

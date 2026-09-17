import { redirect } from "next/navigation";

/** The tab bar points at `/feed`; this keeps the post-login landing and any old link pointing there. */
export default function HomePage() {
  redirect("/feed");
}

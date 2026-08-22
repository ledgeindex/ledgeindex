import { redirect } from "next/navigation";

/** @deprecated Use `/widget` */
export default function IntegrationsRedirectPage() {
  redirect("/widget");
}

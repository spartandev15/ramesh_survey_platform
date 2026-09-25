import { redirect } from "next/navigation";
import { isPsgStaff } from "@/modules/access/capabilities";
import { getCurrentUser } from "@/modules/access/principal";

/** Send each user to the workspace their role allows. */
export default async function Home() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");

  const { principal } = current;
  if (isPsgStaff(principal)) redirect("/psg");
  if (principal.shopIds.length > 0) redirect(`/shop/${principal.shopIds[0]}`);

  redirect("/no-access");
}

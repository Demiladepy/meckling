import { redirect } from "next/navigation";

/** /docs is the manifesto. */
export default function DocsPage() {
  redirect("/manifesto");
}

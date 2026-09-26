import { CaseGame } from "@/lib/render-case";
import { DEFAULT_CASE_ID } from "@/lib/cases";

/**
 * "/" renders the default case directly (canonical URL "/"); other cases live
 * at /case/[caseId]. The server hands the client only the public view.
 */
export default function Home() {
  return <CaseGame caseId={DEFAULT_CASE_ID} />;
}

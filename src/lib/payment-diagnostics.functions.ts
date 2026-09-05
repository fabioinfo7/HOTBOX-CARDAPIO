import { createServerFn } from "@tanstack/react-start";
import { runPaymentScenarioTests } from "./payment-scenario-tests.server";

export const runPaymentDiagnosticsFn = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const results = await runPaymentScenarioTests(supabaseAdmin);
  return { results };
});

import { createServerFn } from "@tanstack/react-start";

export const runPaymentDiagnosticsFn = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { runPaymentScenarioTests } = await import("./payment-scenario-tests.server");
  const results = await runPaymentScenarioTests(supabaseAdmin);
  return { results };
});

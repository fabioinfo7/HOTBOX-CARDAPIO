import { createFileRoute } from "@tanstack/react-router";

const VERSION="HOTBOX_APPMAX_V1_20260909";

export const Route=createFileRoute("/api/public/webhooks/appmax")({
  server:{handlers:{
    GET:async()=>Response.json({ok:true,service:"hotbox-appmax-webhook",version:VERSION}),
    POST:async({request})=>{
      const payload:any=await request.json().catch(()=>({}));
      const event=String(payload?.event || "").toLowerCase();
      if(!["order_approved","order_paid_by_pix","order_integrated"].includes(event)){
        return Response.json({ok:true,ignored:true,event,version:VERSION},{status:200});
      }

      const orderId=String(payload?.data?.order?.id ?? payload?.data?.order_id ?? "").trim();
      if(!orderId)return Response.json({ok:true,ignored:true,reason:"order_id_missing",version:VERSION},{status:200});

      const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
      const {data:checkout,error}=await (supabaseAdmin as any)
        .from("site_checkout_sessions")
        .select("id,total,order_id,payment_provider,appmax_order_id,appmax_payment_method")
        .eq("appmax_order_id",Number(orderId))
        .maybeSingle();
      if(error)return Response.json({ok:false,retry:true,version:VERSION},{status:503});
      if(!checkout || checkout.payment_provider!=="appmax"){
        return Response.json({ok:true,ignored:true,reason:"checkout_not_found",version:VERSION},{status:200});
      }

      const {loadAppmaxConfig,fetchAppmaxOrder,storeAppmaxSnapshot,finalizeAppmaxIfApproved}=await import("@/lib/appmax.functions");
      const cfg=await loadAppmaxConfig(supabaseAdmin);
      if(!cfg.enabled)return Response.json({ok:true,ignored:true,reason:"appmax_disabled",version:VERSION},{status:200});

      // O payload do webhook não libera o pedido sozinho: consulta a API oficial.
      const verified=await fetchAppmaxOrder(cfg,orderId);
      if(!verified.response.ok)return Response.json({ok:false,retry:true,version:VERSION},{status:503});

      await storeAppmaxSnapshot(supabaseAdmin,checkout.id,verified.body,payload);
      const {data:fresh}=await (supabaseAdmin as any)
        .from("site_checkout_sessions")
        .select("id,total,order_id,payment_provider,appmax_order_id,appmax_payment_method")
        .eq("id",checkout.id)
        .maybeSingle();
      const result=await finalizeAppmaxIfApproved(supabaseAdmin,fresh || checkout,verified.body);
      if(!result.ok && (result as any).transient){
        return Response.json({ok:false,retry:true,version:VERSION},{status:503});
      }
      return Response.json({ok:true,received:true,processed:!!result.ok,pending:!!(result as any).pending,version:VERSION},{status:200});
    },
  }},
});

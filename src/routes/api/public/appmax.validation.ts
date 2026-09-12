import { createFileRoute } from "@tanstack/react-router";

export const Route=createFileRoute("/api/public/appmax/validation")({
  server:{handlers:{
    GET:async()=>Response.json({ok:true,service:"hotbox-appmax-validation"}),
    POST:async({request})=>{
      const payload:any=await request.json().catch(()=>({}));
      const appId=Number(payload?.app_id || 0);
      if(!appId)return Response.json({error:"app_id obrigatório"},{status:400});

      const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
      const {data:cfg}=await (supabaseAdmin as any)
        .from("store_config")
        .select("store_name,appmax_app_numerical_id,appmax_external_id")
        .eq("id",1)
        .maybeSingle();

      // O administrador precisa cadastrar o App Numerical ID primeiro.
      if(!cfg?.appmax_app_numerical_id){
        return Response.json({error:"Appmax App Numerical ID ainda não configurado na Hotbox"},{status:409});
      }
      if(Number(cfg.appmax_app_numerical_id)!==appId){
        return Response.json({error:"app_id não autorizado"},{status:403});
      }

      const externalId=crypto.randomUUID();
      const patch:any={appmax_external_id:externalId};
      if(payload?.client_id)patch.appmax_merchant_client_id=String(payload.client_id);
      if(payload?.client_secret)patch.appmax_merchant_client_secret=String(payload.client_secret);
      await (supabaseAdmin as any).from("store_config").update(patch).eq("id",1);

      return Response.json({external_id:externalId,alias:String(cfg?.store_name || "Hotbox Delivery")},{status:200});
    },
  }},
});

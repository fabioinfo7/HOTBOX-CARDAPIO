/* eslint-disable */
// @ts-nocheck

import { Route as rootRouteImport } from './routes/__root'
import { Route as AuthenticatedEntregadorRouteImport } from './routes/_authenticated/entregador'
import { Route as AuthenticatedLojaAvaliacoesRouteImport } from './routes/_authenticated/loja.avaliacoes'
import { Route as AuthenticatedLojaChatRouteImport } from './routes/_authenticated/loja.chat'
import { Route as AuthenticatedLojaConfigRouteImport } from './routes/_authenticated/loja.config'
import { Route as AuthenticatedLojaCuponsRouteImport } from './routes/_authenticated/loja.cupons'
import { Route as AuthenticatedLojaDashboardRouteImport } from './routes/_authenticated/loja.dashboard'
import { Route as AuthenticatedLojaEntregadoresRouteImport } from './routes/_authenticated/loja.entregadores'
import { Route as AuthenticatedLojaFidelidadeRouteImport } from './routes/_authenticated/loja.fidelidade'
import { Route as AuthenticatedLojaFinanceiroCardapioRouteImport } from './routes/_authenticated/loja.financeiro-cardapio'
import { Route as AuthenticatedLojaFinanceiroRouteImport } from './routes/_authenticated/loja.financeiro'
import { Route as AuthenticatedLojaFreteRouteImport } from './routes/_authenticated/loja.frete'
import { Route as AuthenticatedLojaIndexRouteImport } from './routes/_authenticated/loja.index'
import { Route as AuthenticatedLojaLeadsRouteImport } from './routes/_authenticated/loja.leads'
import { Route as AuthenticatedLojaLogsRouteImport } from './routes/_authenticated/loja.logs'
import { Route as AuthenticatedLojaPedidoIdRouteImport } from './routes/_authenticated/loja.pedido.$id'
import { Route as AuthenticatedLojaPedidosRouteImport } from './routes/_authenticated/loja.pedidos'
import { Route as AuthenticatedLojaPrecificacaoRouteImport } from './routes/_authenticated/loja.precificacao'
import { Route as AuthenticatedLojaProdutosRouteImport } from './routes/_authenticated/loja.produtos'
import { Route as AuthenticatedLojaReceberRouteImport } from './routes/_authenticated/loja.receber'
import { Route as AuthenticatedLojaReengajamentoRouteImport } from './routes/_authenticated/loja.reengajamento'
import { Route as AuthenticatedLojaRouteImport } from './routes/_authenticated/loja'
import { Route as AuthenticatedLojaZonasEntregaRouteImport } from './routes/_authenticated/loja.zonas-entrega'
import { Route as AuthenticatedRouteRouteImport } from './routes/_authenticated/route'
import { Route as AdminLoginRouteImport } from './routes/admin.login'
import { Route as ApiPublicHooksSatisfactionAutoRouteImport } from './routes/api/public/hooks/satisfaction-auto'
import { Route as ApiPublicHooksSystemAlertsRouteImport } from './routes/api/public/hooks/system-alerts'
import { Route as ApiPublicWebhooksEvolutionRouteImport } from './routes/api/public/webhooks.evolution'
import { Route as ApiPublicWebhooksIfoodPollRouteImport } from './routes/api/public/webhooks.ifood-poll'
import { Route as ApiPublicWebhooksIfoodStatusPushRouteImport } from './routes/api/public/webhooks.ifood-status-push'
import { Route as ApiPublicWebhooksIfoodRouteImport } from './routes/api/public/webhooks.ifood'
import { Route as ApiPublicWebhooksInfinitepayRouteImport } from './routes/api/public/webhooks.infinitepay'
import { Route as ApiPublicWebhooksMercadopagoRouteImport } from './routes/api/public/webhooks.mercadopago'
import { Route as ApiPublicWebhooksMetaRouteImport } from './routes/api/public/webhooks.meta'
import { Route as ApiPublicWebhooksNfoodStatusPushRouteImport } from './routes/api/public/webhooks.nfood-status-push'
import { Route as ApiPublicWebhooksNfoodRouteImport } from './routes/api/public/webhooks.nfood'
import { Route as ApiPublicWebhooksStripeRouteImport } from './routes/api/public/webhooks.stripe'
import { Route as ApiPublicWebhooksWhatsappNotifyRouteImport } from './routes/api/public/webhooks.whatsapp-notify'
import { Route as AppRouteImport } from './routes/app'
import { Route as AvaliacaoTokenRouteImport } from './routes/avaliacao.$token'
import { Route as BioRouteImport } from './routes/bio'
import { Route as CheckoutIdRouteImport } from './routes/checkout.$id'
import { Route as EntregadorLoginRouteImport } from './routes/entregador.login'
import { Route as IndexRouteImport } from './routes/index'
import { Route as MeusPedidosRouteImport } from './routes/meus-pedidos'
import { Route as ObrigadoRouteImport } from './routes/obrigado'
import { Route as PedidoIdRouteImport } from './routes/pedido.$id'
import { Route as PoliticaDePrivacidadeRouteImport } from './routes/politica-de-privacidade'

const AuthenticatedEntregadorRoute = AuthenticatedEntregadorRouteImport.update({
  id: '/entregador',
  path: '/entregador',
  getParentRoute: () => AuthenticatedRouteRoute,
} as any)
const AuthenticatedLojaAvaliacoesRoute = AuthenticatedLojaAvaliacoesRouteImport.update({
  id: '/avaliacoes',
  path: '/avaliacoes',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaChatRoute = AuthenticatedLojaChatRouteImport.update({
  id: '/chat',
  path: '/chat',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaConfigRoute = AuthenticatedLojaConfigRouteImport.update({
  id: '/config',
  path: '/config',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaCuponsRoute = AuthenticatedLojaCuponsRouteImport.update({
  id: '/cupons',
  path: '/cupons',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaDashboardRoute = AuthenticatedLojaDashboardRouteImport.update({
  id: '/dashboard',
  path: '/dashboard',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaEntregadoresRoute = AuthenticatedLojaEntregadoresRouteImport.update({
  id: '/entregadores',
  path: '/entregadores',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaFidelidadeRoute = AuthenticatedLojaFidelidadeRouteImport.update({
  id: '/fidelidade',
  path: '/fidelidade',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaFinanceiroCardapioRoute = AuthenticatedLojaFinanceiroCardapioRouteImport.update({
  id: '/financeiro-cardapio',
  path: '/financeiro-cardapio',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaFinanceiroRoute = AuthenticatedLojaFinanceiroRouteImport.update({
  id: '/financeiro',
  path: '/financeiro',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaFreteRoute = AuthenticatedLojaFreteRouteImport.update({
  id: '/frete',
  path: '/frete',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaIndexRoute = AuthenticatedLojaIndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaLeadsRoute = AuthenticatedLojaLeadsRouteImport.update({
  id: '/leads',
  path: '/leads',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaLogsRoute = AuthenticatedLojaLogsRouteImport.update({
  id: '/logs',
  path: '/logs',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaPedidoIdRoute = AuthenticatedLojaPedidoIdRouteImport.update({
  id: '/pedido/$id',
  path: '/pedido/$id',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaPedidosRoute = AuthenticatedLojaPedidosRouteImport.update({
  id: '/pedidos',
  path: '/pedidos',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaPrecificacaoRoute = AuthenticatedLojaPrecificacaoRouteImport.update({
  id: '/precificacao',
  path: '/precificacao',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaProdutosRoute = AuthenticatedLojaProdutosRouteImport.update({
  id: '/produtos',
  path: '/produtos',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaReceberRoute = AuthenticatedLojaReceberRouteImport.update({
  id: '/receber',
  path: '/receber',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaReengajamentoRoute = AuthenticatedLojaReengajamentoRouteImport.update({
  id: '/reengajamento',
  path: '/reengajamento',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedLojaRoute = AuthenticatedLojaRouteImport.update({
  id: '/loja',
  path: '/loja',
  getParentRoute: () => AuthenticatedRouteRoute,
} as any)
const AuthenticatedLojaZonasEntregaRoute = AuthenticatedLojaZonasEntregaRouteImport.update({
  id: '/zonas-entrega',
  path: '/zonas-entrega',
  getParentRoute: () => AuthenticatedLojaRoute,
} as any)
const AuthenticatedRouteRoute = AuthenticatedRouteRouteImport.update({
  id: '/_authenticated',
  getParentRoute: () => rootRouteImport,
} as any)
const AdminLoginRoute = AdminLoginRouteImport.update({
  id: '/admin/login',
  path: '/admin/login',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicHooksSatisfactionAutoRoute = ApiPublicHooksSatisfactionAutoRouteImport.update({
  id: '/api/public/hooks/satisfaction-auto',
  path: '/api/public/hooks/satisfaction-auto',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicHooksSystemAlertsRoute = ApiPublicHooksSystemAlertsRouteImport.update({
  id: '/api/public/hooks/system-alerts',
  path: '/api/public/hooks/system-alerts',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicWebhooksEvolutionRoute = ApiPublicWebhooksEvolutionRouteImport.update({
  id: '/api/public/webhooks/evolution',
  path: '/api/public/webhooks/evolution',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicWebhooksIfoodPollRoute = ApiPublicWebhooksIfoodPollRouteImport.update({
  id: '/api/public/webhooks/ifood-poll',
  path: '/api/public/webhooks/ifood-poll',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicWebhooksIfoodStatusPushRoute = ApiPublicWebhooksIfoodStatusPushRouteImport.update({
  id: '/api/public/webhooks/ifood-status-push',
  path: '/api/public/webhooks/ifood-status-push',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicWebhooksIfoodRoute = ApiPublicWebhooksIfoodRouteImport.update({
  id: '/api/public/webhooks/ifood',
  path: '/api/public/webhooks/ifood',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicWebhooksInfinitepayRoute = ApiPublicWebhooksInfinitepayRouteImport.update({
  id: '/api/public/webhooks/infinitepay',
  path: '/api/public/webhooks/infinitepay',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicWebhooksMercadopagoRoute = ApiPublicWebhooksMercadopagoRouteImport.update({
  id: '/api/public/webhooks/mercadopago',
  path: '/api/public/webhooks/mercadopago',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicWebhooksMetaRoute = ApiPublicWebhooksMetaRouteImport.update({
  id: '/api/public/webhooks/meta',
  path: '/api/public/webhooks/meta',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicWebhooksNfoodStatusPushRoute = ApiPublicWebhooksNfoodStatusPushRouteImport.update({
  id: '/api/public/webhooks/nfood-status-push',
  path: '/api/public/webhooks/nfood-status-push',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicWebhooksNfoodRoute = ApiPublicWebhooksNfoodRouteImport.update({
  id: '/api/public/webhooks/nfood',
  path: '/api/public/webhooks/nfood',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicWebhooksStripeRoute = ApiPublicWebhooksStripeRouteImport.update({
  id: '/api/public/webhooks/stripe',
  path: '/api/public/webhooks/stripe',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiPublicWebhooksWhatsappNotifyRoute = ApiPublicWebhooksWhatsappNotifyRouteImport.update({
  id: '/api/public/webhooks/whatsapp-notify',
  path: '/api/public/webhooks/whatsapp-notify',
  getParentRoute: () => rootRouteImport,
} as any)
const AppRoute = AppRouteImport.update({
  id: '/app',
  path: '/app',
  getParentRoute: () => rootRouteImport,
} as any)
const AvaliacaoTokenRoute = AvaliacaoTokenRouteImport.update({
  id: '/avaliacao/$token',
  path: '/avaliacao/$token',
  getParentRoute: () => rootRouteImport,
} as any)
const BioRoute = BioRouteImport.update({
  id: '/bio',
  path: '/bio',
  getParentRoute: () => rootRouteImport,
} as any)
const CheckoutIdRoute = CheckoutIdRouteImport.update({
  id: '/checkout/$id',
  path: '/checkout/$id',
  getParentRoute: () => rootRouteImport,
} as any)
const EntregadorLoginRoute = EntregadorLoginRouteImport.update({
  id: '/entregador/login',
  path: '/entregador/login',
  getParentRoute: () => rootRouteImport,
} as any)
const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any)
const MeusPedidosRoute = MeusPedidosRouteImport.update({
  id: '/meus-pedidos',
  path: '/meus-pedidos',
  getParentRoute: () => rootRouteImport,
} as any)
const ObrigadoRoute = ObrigadoRouteImport.update({
  id: '/obrigado',
  path: '/obrigado',
  getParentRoute: () => rootRouteImport,
} as any)
const PedidoIdRoute = PedidoIdRouteImport.update({
  id: '/pedido/$id',
  path: '/pedido/$id',
  getParentRoute: () => rootRouteImport,
} as any)
const PoliticaDePrivacidadeRoute = PoliticaDePrivacidadeRouteImport.update({
  id: '/politica-de-privacidade',
  path: '/politica-de-privacidade',
  getParentRoute: () => rootRouteImport,
} as any)

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/_authenticated/entregador': {
      id: '/_authenticated/entregador'
      path: '/entregador'
      fullPath: '/entregador'
      preLoaderRoute: typeof AuthenticatedEntregadorRouteImport
      parentRoute: typeof AuthenticatedRouteRoute
    }
    '/_authenticated/loja/avaliacoes': {
      id: '/_authenticated/loja/avaliacoes'
      path: '/avaliacoes'
      fullPath: '/loja/avaliacoes'
      preLoaderRoute: typeof AuthenticatedLojaAvaliacoesRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/chat': {
      id: '/_authenticated/loja/chat'
      path: '/chat'
      fullPath: '/loja/chat'
      preLoaderRoute: typeof AuthenticatedLojaChatRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/config': {
      id: '/_authenticated/loja/config'
      path: '/config'
      fullPath: '/loja/config'
      preLoaderRoute: typeof AuthenticatedLojaConfigRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/cupons': {
      id: '/_authenticated/loja/cupons'
      path: '/cupons'
      fullPath: '/loja/cupons'
      preLoaderRoute: typeof AuthenticatedLojaCuponsRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/dashboard': {
      id: '/_authenticated/loja/dashboard'
      path: '/dashboard'
      fullPath: '/loja/dashboard'
      preLoaderRoute: typeof AuthenticatedLojaDashboardRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/entregadores': {
      id: '/_authenticated/loja/entregadores'
      path: '/entregadores'
      fullPath: '/loja/entregadores'
      preLoaderRoute: typeof AuthenticatedLojaEntregadoresRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/fidelidade': {
      id: '/_authenticated/loja/fidelidade'
      path: '/fidelidade'
      fullPath: '/loja/fidelidade'
      preLoaderRoute: typeof AuthenticatedLojaFidelidadeRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/financeiro-cardapio': {
      id: '/_authenticated/loja/financeiro-cardapio'
      path: '/financeiro-cardapio'
      fullPath: '/loja/financeiro-cardapio'
      preLoaderRoute: typeof AuthenticatedLojaFinanceiroCardapioRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/financeiro': {
      id: '/_authenticated/loja/financeiro'
      path: '/financeiro'
      fullPath: '/loja/financeiro'
      preLoaderRoute: typeof AuthenticatedLojaFinanceiroRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/frete': {
      id: '/_authenticated/loja/frete'
      path: '/frete'
      fullPath: '/loja/frete'
      preLoaderRoute: typeof AuthenticatedLojaFreteRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/': {
      id: '/_authenticated/loja/'
      path: '/'
      fullPath: '/loja/'
      preLoaderRoute: typeof AuthenticatedLojaIndexRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/leads': {
      id: '/_authenticated/loja/leads'
      path: '/leads'
      fullPath: '/loja/leads'
      preLoaderRoute: typeof AuthenticatedLojaLeadsRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/logs': {
      id: '/_authenticated/loja/logs'
      path: '/logs'
      fullPath: '/loja/logs'
      preLoaderRoute: typeof AuthenticatedLojaLogsRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/pedido/$id': {
      id: '/_authenticated/loja/pedido/$id'
      path: '/pedido/$id'
      fullPath: '/loja/pedido/$id'
      preLoaderRoute: typeof AuthenticatedLojaPedidoIdRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/pedidos': {
      id: '/_authenticated/loja/pedidos'
      path: '/pedidos'
      fullPath: '/loja/pedidos'
      preLoaderRoute: typeof AuthenticatedLojaPedidosRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/precificacao': {
      id: '/_authenticated/loja/precificacao'
      path: '/precificacao'
      fullPath: '/loja/precificacao'
      preLoaderRoute: typeof AuthenticatedLojaPrecificacaoRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/produtos': {
      id: '/_authenticated/loja/produtos'
      path: '/produtos'
      fullPath: '/loja/produtos'
      preLoaderRoute: typeof AuthenticatedLojaProdutosRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/receber': {
      id: '/_authenticated/loja/receber'
      path: '/receber'
      fullPath: '/loja/receber'
      preLoaderRoute: typeof AuthenticatedLojaReceberRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja/reengajamento': {
      id: '/_authenticated/loja/reengajamento'
      path: '/reengajamento'
      fullPath: '/loja/reengajamento'
      preLoaderRoute: typeof AuthenticatedLojaReengajamentoRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated/loja': {
      id: '/_authenticated/loja'
      path: '/loja'
      fullPath: '/loja'
      preLoaderRoute: typeof AuthenticatedLojaRouteImport
      parentRoute: typeof AuthenticatedRouteRoute
    }
    '/_authenticated/loja/zonas-entrega': {
      id: '/_authenticated/loja/zonas-entrega'
      path: '/zonas-entrega'
      fullPath: '/loja/zonas-entrega'
      preLoaderRoute: typeof AuthenticatedLojaZonasEntregaRouteImport
      parentRoute: typeof AuthenticatedLojaRoute
    }
    '/_authenticated': {
      id: '/_authenticated'
      path: ''
      fullPath: '/'
      preLoaderRoute: typeof AuthenticatedRouteRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/admin/login': {
      id: '/admin/login'
      path: '/admin/login'
      fullPath: '/admin/login'
      preLoaderRoute: typeof AdminLoginRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/hooks/satisfaction-auto': {
      id: '/api/public/hooks/satisfaction-auto'
      path: '/api/public/hooks/satisfaction-auto'
      fullPath: '/api/public/hooks/satisfaction-auto'
      preLoaderRoute: typeof ApiPublicHooksSatisfactionAutoRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/hooks/system-alerts': {
      id: '/api/public/hooks/system-alerts'
      path: '/api/public/hooks/system-alerts'
      fullPath: '/api/public/hooks/system-alerts'
      preLoaderRoute: typeof ApiPublicHooksSystemAlertsRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/webhooks/evolution': {
      id: '/api/public/webhooks/evolution'
      path: '/api/public/webhooks/evolution'
      fullPath: '/api/public/webhooks/evolution'
      preLoaderRoute: typeof ApiPublicWebhooksEvolutionRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/webhooks/ifood-poll': {
      id: '/api/public/webhooks/ifood-poll'
      path: '/api/public/webhooks/ifood-poll'
      fullPath: '/api/public/webhooks/ifood-poll'
      preLoaderRoute: typeof ApiPublicWebhooksIfoodPollRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/webhooks/ifood-status-push': {
      id: '/api/public/webhooks/ifood-status-push'
      path: '/api/public/webhooks/ifood-status-push'
      fullPath: '/api/public/webhooks/ifood-status-push'
      preLoaderRoute: typeof ApiPublicWebhooksIfoodStatusPushRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/webhooks/ifood': {
      id: '/api/public/webhooks/ifood'
      path: '/api/public/webhooks/ifood'
      fullPath: '/api/public/webhooks/ifood'
      preLoaderRoute: typeof ApiPublicWebhooksIfoodRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/webhooks/infinitepay': {
      id: '/api/public/webhooks/infinitepay'
      path: '/api/public/webhooks/infinitepay'
      fullPath: '/api/public/webhooks/infinitepay'
      preLoaderRoute: typeof ApiPublicWebhooksInfinitepayRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/webhooks/mercadopago': {
      id: '/api/public/webhooks/mercadopago'
      path: '/api/public/webhooks/mercadopago'
      fullPath: '/api/public/webhooks/mercadopago'
      preLoaderRoute: typeof ApiPublicWebhooksMercadopagoRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/webhooks/meta': {
      id: '/api/public/webhooks/meta'
      path: '/api/public/webhooks/meta'
      fullPath: '/api/public/webhooks/meta'
      preLoaderRoute: typeof ApiPublicWebhooksMetaRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/webhooks/nfood-status-push': {
      id: '/api/public/webhooks/nfood-status-push'
      path: '/api/public/webhooks/nfood-status-push'
      fullPath: '/api/public/webhooks/nfood-status-push'
      preLoaderRoute: typeof ApiPublicWebhooksNfoodStatusPushRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/webhooks/nfood': {
      id: '/api/public/webhooks/nfood'
      path: '/api/public/webhooks/nfood'
      fullPath: '/api/public/webhooks/nfood'
      preLoaderRoute: typeof ApiPublicWebhooksNfoodRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/webhooks/stripe': {
      id: '/api/public/webhooks/stripe'
      path: '/api/public/webhooks/stripe'
      fullPath: '/api/public/webhooks/stripe'
      preLoaderRoute: typeof ApiPublicWebhooksStripeRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/public/webhooks/whatsapp-notify': {
      id: '/api/public/webhooks/whatsapp-notify'
      path: '/api/public/webhooks/whatsapp-notify'
      fullPath: '/api/public/webhooks/whatsapp-notify'
      preLoaderRoute: typeof ApiPublicWebhooksWhatsappNotifyRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/app': {
      id: '/app'
      path: '/app'
      fullPath: '/app'
      preLoaderRoute: typeof AppRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/avaliacao/$token': {
      id: '/avaliacao/$token'
      path: '/avaliacao/$token'
      fullPath: '/avaliacao/$token'
      preLoaderRoute: typeof AvaliacaoTokenRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/bio': {
      id: '/bio'
      path: '/bio'
      fullPath: '/bio'
      preLoaderRoute: typeof BioRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/checkout/$id': {
      id: '/checkout/$id'
      path: '/checkout/$id'
      fullPath: '/checkout/$id'
      preLoaderRoute: typeof CheckoutIdRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/entregador/login': {
      id: '/entregador/login'
      path: '/entregador/login'
      fullPath: '/entregador/login'
      preLoaderRoute: typeof EntregadorLoginRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/meus-pedidos': {
      id: '/meus-pedidos'
      path: '/meus-pedidos'
      fullPath: '/meus-pedidos'
      preLoaderRoute: typeof MeusPedidosRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/obrigado': {
      id: '/obrigado'
      path: '/obrigado'
      fullPath: '/obrigado'
      preLoaderRoute: typeof ObrigadoRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/pedido/$id': {
      id: '/pedido/$id'
      path: '/pedido/$id'
      fullPath: '/pedido/$id'
      preLoaderRoute: typeof PedidoIdRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/politica-de-privacidade': {
      id: '/politica-de-privacidade'
      path: '/politica-de-privacidade'
      fullPath: '/politica-de-privacidade'
      preLoaderRoute: typeof PoliticaDePrivacidadeRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const AuthenticatedLojaRouteChildren = {
  AuthenticatedLojaAvaliacoesRoute: AuthenticatedLojaAvaliacoesRoute,
  AuthenticatedLojaChatRoute: AuthenticatedLojaChatRoute,
  AuthenticatedLojaConfigRoute: AuthenticatedLojaConfigRoute,
  AuthenticatedLojaCuponsRoute: AuthenticatedLojaCuponsRoute,
  AuthenticatedLojaDashboardRoute: AuthenticatedLojaDashboardRoute,
  AuthenticatedLojaEntregadoresRoute: AuthenticatedLojaEntregadoresRoute,
  AuthenticatedLojaFidelidadeRoute: AuthenticatedLojaFidelidadeRoute,
  AuthenticatedLojaFinanceiroCardapioRoute: AuthenticatedLojaFinanceiroCardapioRoute,
  AuthenticatedLojaFinanceiroRoute: AuthenticatedLojaFinanceiroRoute,
  AuthenticatedLojaFreteRoute: AuthenticatedLojaFreteRoute,
  AuthenticatedLojaIndexRoute: AuthenticatedLojaIndexRoute,
  AuthenticatedLojaLeadsRoute: AuthenticatedLojaLeadsRoute,
  AuthenticatedLojaLogsRoute: AuthenticatedLojaLogsRoute,
  AuthenticatedLojaPedidoIdRoute: AuthenticatedLojaPedidoIdRoute,
  AuthenticatedLojaPedidosRoute: AuthenticatedLojaPedidosRoute,
  AuthenticatedLojaPrecificacaoRoute: AuthenticatedLojaPrecificacaoRoute,
  AuthenticatedLojaProdutosRoute: AuthenticatedLojaProdutosRoute,
  AuthenticatedLojaReceberRoute: AuthenticatedLojaReceberRoute,
  AuthenticatedLojaReengajamentoRoute: AuthenticatedLojaReengajamentoRoute,
  AuthenticatedLojaZonasEntregaRoute: AuthenticatedLojaZonasEntregaRoute,
}
const AuthenticatedLojaRouteWithChildren = AuthenticatedLojaRoute._addFileChildren(AuthenticatedLojaRouteChildren)

const AuthenticatedRouteRouteChildren = {
  AuthenticatedEntregadorRoute: AuthenticatedEntregadorRoute,
  AuthenticatedLojaRoute: AuthenticatedLojaRouteWithChildren,
}
const AuthenticatedRouteRouteWithChildren = AuthenticatedRouteRoute._addFileChildren(AuthenticatedRouteRouteChildren)

const rootRouteChildren = {
  AdminLoginRoute: AdminLoginRoute,
  ApiPublicHooksSatisfactionAutoRoute: ApiPublicHooksSatisfactionAutoRoute,
  ApiPublicHooksSystemAlertsRoute: ApiPublicHooksSystemAlertsRoute,
  ApiPublicWebhooksEvolutionRoute: ApiPublicWebhooksEvolutionRoute,
  ApiPublicWebhooksIfoodPollRoute: ApiPublicWebhooksIfoodPollRoute,
  ApiPublicWebhooksIfoodStatusPushRoute: ApiPublicWebhooksIfoodStatusPushRoute,
  ApiPublicWebhooksIfoodRoute: ApiPublicWebhooksIfoodRoute,
  ApiPublicWebhooksInfinitepayRoute: ApiPublicWebhooksInfinitepayRoute,
  ApiPublicWebhooksMercadopagoRoute: ApiPublicWebhooksMercadopagoRoute,
  ApiPublicWebhooksMetaRoute: ApiPublicWebhooksMetaRoute,
  ApiPublicWebhooksNfoodStatusPushRoute: ApiPublicWebhooksNfoodStatusPushRoute,
  ApiPublicWebhooksNfoodRoute: ApiPublicWebhooksNfoodRoute,
  ApiPublicWebhooksStripeRoute: ApiPublicWebhooksStripeRoute,
  ApiPublicWebhooksWhatsappNotifyRoute: ApiPublicWebhooksWhatsappNotifyRoute,
  AppRoute: AppRoute,
  AvaliacaoTokenRoute: AvaliacaoTokenRoute,
  BioRoute: BioRoute,
  CheckoutIdRoute: CheckoutIdRoute,
  EntregadorLoginRoute: EntregadorLoginRoute,
  IndexRoute: IndexRoute,
  MeusPedidosRoute: MeusPedidosRoute,
  ObrigadoRoute: ObrigadoRoute,
  PedidoIdRoute: PedidoIdRoute,
  PoliticaDePrivacidadeRoute: PoliticaDePrivacidadeRoute,
  AuthenticatedRouteRoute: AuthenticatedRouteRouteWithChildren,
}

export const routeTree = rootRouteImport._addFileChildren(rootRouteChildren)

import type { getRouter } from './router.tsx'
import type { startInstance } from './start.ts'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
    config: Awaited<ReturnType<typeof startInstance.getOptions>>
  }
}

import { LeadsService } from "../../../backend/src/modules/leads/leads.service";
import { MercadoPagoService } from "../../../backend/src/modules/mercado-pago/mercado-pago.service";
import { OpsService } from "../../../backend/src/modules/ops/ops.service";
import { OnboardingService } from "../../../backend/src/modules/onboarding/onboarding.service";
import { ConversationsService } from "../../../backend/src/modules/conversations/conversations.service";
import { DashboardService } from "../../../backend/src/modules/dashboard/dashboard.service";
import { ProductsService } from "../../../backend/src/modules/products/products.service";
import { CategoriesService } from "../../../backend/src/modules/categories/categories.service";
import { MessageReceiverService } from "../../../backend/src/modules/messages/receiver.service";
import { TiendaConfigService } from "../../../backend/src/modules/tienda-config/tienda-config.service";
import { OrdersService } from "../../../backend/src/modules/orders/orders.service";

export type BackendServices = {
  leads: LeadsService;
  mercadoPago: MercadoPagoService;
  ops: OpsService;
  onboarding: OnboardingService;
  conversations: ConversationsService;
  dashboard: DashboardService;
  products: ProductsService;
  categories: CategoriesService;
  messages: MessageReceiverService;
  tiendaConfig: TiendaConfigService;
  orders: OrdersService;
};

let cached: BackendServices | null = null;

export function getBackendServices(): BackendServices {
  if (!cached) {
    const leads = new LeadsService();
    const orders = new OrdersService();
    const mercadoPago = new MercadoPagoService(leads, orders);
    const ops = new OpsService();
    const onboarding = new OnboardingService(mercadoPago, ops);
    const conversations = new ConversationsService(mercadoPago);
    const dashboard = new DashboardService(leads, onboarding);
    const products = new ProductsService();
    const categories = new CategoriesService();
    const messages = new MessageReceiverService();
    const tiendaConfig = new TiendaConfigService();
    cached = { leads, mercadoPago, ops, onboarding, conversations, dashboard, products, categories, messages, tiendaConfig, orders };
  }
  return cached;
}

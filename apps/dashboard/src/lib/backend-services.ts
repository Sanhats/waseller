import { LeadsService } from "../../../backend/src/modules/leads/leads.service";
import { MercadoPagoService } from "../../../backend/src/modules/mercado-pago/mercado-pago.service";
import { OpsService } from "../../../backend/src/modules/ops/ops.service";
import { OnboardingService } from "../../../backend/src/modules/onboarding/onboarding.service";
import { ConversationsService } from "../../../backend/src/modules/conversations/conversations.service";
import { DashboardService } from "../../../backend/src/modules/dashboard/dashboard.service";
import { ProductsService } from "../../../backend/src/modules/products/products.service";
import { MessageReceiverService } from "../../../backend/src/modules/messages/receiver.service";

export type BackendServices = {
  leads: LeadsService;
  mercadoPago: MercadoPagoService;
  ops: OpsService;
  onboarding: OnboardingService;
  conversations: ConversationsService;
  dashboard: DashboardService;
  products: ProductsService;
  messages: MessageReceiverService;
};

let cached: BackendServices | null = null;

export function getBackendServices(): BackendServices {
  if (!cached) {
    const leads = new LeadsService();
    const mercadoPago = new MercadoPagoService(leads);
    const ops = new OpsService();
    const onboarding = new OnboardingService(mercadoPago, ops);
    const conversations = new ConversationsService(mercadoPago);
    const dashboard = new DashboardService(leads, onboarding);
    const products = new ProductsService();
    const messages = new MessageReceiverService();
    cached = { leads, mercadoPago, ops, onboarding, conversations, dashboard, products, messages };
  }
  return cached;
}

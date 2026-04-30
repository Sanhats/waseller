import { Module } from "@nestjs/common";
import { MessageReceiverController } from "./messages/receiver.controller";
import { MessageReceiverService } from "./messages/receiver.service";
import { LeadsController } from "./leads/leads.controller";
import { LeadsService } from "./leads/leads.service";
import { ConversationsController } from "./conversations/conversations.controller";
import { ConversationsService } from "./conversations/conversations.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { OpsController } from "./ops/ops.controller";
import { OpsService } from "./ops/ops.service";
import { ProductsController } from "./products/products.controller";
import { ProductsService } from "./products/products.service";
import { CategoriesController } from "./categories/categories.controller";
import { CategoriesService } from "./categories/categories.service";
import { OnboardingController } from "./onboarding/onboarding.controller";
import { OnboardingService } from "./onboarding/onboarding.service";
import { MercadoPagoController } from "./mercado-pago/mercado-pago.controller";
import { MercadoPagoService } from "./mercado-pago/mercado-pago.service";
import { DashboardController } from "./dashboard/dashboard.controller";
import { DashboardService } from "./dashboard/dashboard.service";
import { OrdersService } from "./orders/orders.service";

@Module({
  controllers: [
    AuthController,
    MessageReceiverController,
    LeadsController,
    ConversationsController,
    OpsController,
    ProductsController,
    CategoriesController,
    OnboardingController,
    MercadoPagoController,
    DashboardController
  ],
  providers: [
    AuthService,
    MessageReceiverService,
    LeadsService,
    ConversationsService,
    OpsService,
    ProductsService,
    CategoriesService,
    OnboardingService,
    MercadoPagoService,
    DashboardService,
    OrdersService
  ]
})
export class AppModule {}

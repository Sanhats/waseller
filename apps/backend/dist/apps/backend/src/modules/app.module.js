"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const receiver_controller_1 = require("./messages/receiver.controller");
const receiver_service_1 = require("./messages/receiver.service");
const leads_controller_1 = require("./leads/leads.controller");
const leads_service_1 = require("./leads/leads.service");
const conversations_controller_1 = require("./conversations/conversations.controller");
const conversations_service_1 = require("./conversations/conversations.service");
const auth_controller_1 = require("./auth/auth.controller");
const auth_service_1 = require("./auth/auth.service");
const ops_controller_1 = require("./ops/ops.controller");
const ops_service_1 = require("./ops/ops.service");
const products_controller_1 = require("./products/products.controller");
const products_service_1 = require("./products/products.service");
const onboarding_controller_1 = require("./onboarding/onboarding.controller");
const onboarding_service_1 = require("./onboarding/onboarding.service");
const mercado_pago_controller_1 = require("./mercado-pago/mercado-pago.controller");
const mercado_pago_service_1 = require("./mercado-pago/mercado-pago.service");
const dashboard_controller_1 = require("./dashboard/dashboard.controller");
const dashboard_service_1 = require("./dashboard/dashboard.service");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        controllers: [
            auth_controller_1.AuthController,
            receiver_controller_1.MessageReceiverController,
            leads_controller_1.LeadsController,
            conversations_controller_1.ConversationsController,
            ops_controller_1.OpsController,
            products_controller_1.ProductsController,
            onboarding_controller_1.OnboardingController,
            mercado_pago_controller_1.MercadoPagoController,
            dashboard_controller_1.DashboardController
        ],
        providers: [
            auth_service_1.AuthService,
            receiver_service_1.MessageReceiverService,
            leads_service_1.LeadsService,
            conversations_service_1.ConversationsService,
            ops_service_1.OpsService,
            products_service_1.ProductsService,
            onboarding_service_1.OnboardingService,
            mercado_pago_service_1.MercadoPagoService,
            dashboard_service_1.DashboardService
        ]
    })
], AppModule);

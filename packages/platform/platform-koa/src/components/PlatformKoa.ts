import KoaRouter, {RouterOptions as KoaRouterOptions} from "@koa/router";
import {
  createContext,
  getContext,
  InjectorService,
  PlatformAdapter,
  PlatformApplication,
  PlatformBuilder,
  PlatformExceptions,
  PlatformHandler,
  PlatformMulter,
  PlatformMulterSettings,
  PlatformRequest,
  PlatformResponse,
  PlatformStaticsOptions,
  runInContext
} from "@tsed/common";
import {isFunction, Type} from "@tsed/core";
import {IncomingMessage, ServerResponse} from "http";
import Koa, {Context, Next} from "koa";
import koaBodyParser, {Options} from "koa-bodyparser";
// @ts-ignore
import koaQs from "koa-qs";
import send from "koa-send";
import {staticsMiddleware} from "../middlewares/staticsMiddleware";
import {PlatformKoaHandler} from "../services/PlatformKoaHandler";
import {PlatformKoaRequest} from "../services/PlatformKoaRequest";
import {PlatformKoaResponse} from "../services/PlatformKoaResponse";
import {getMulter} from "../utils/multer";

declare global {
  namespace TsED {
    export interface Application extends Koa {}
  }

  namespace TsED {
    export interface Router extends KoaRouter {}

    export interface RouterOptions extends KoaRouterOptions {}

    export interface StaticsOptions extends send.SendOptions {}
  }
}

// @ts-ignore
KoaRouter.prototype.$$match = KoaRouter.prototype.match;
KoaRouter.prototype.match = function match(...args: any[]) {
  const matched = this.$$match(...args);
  if (matched) {
    if (matched.path.length) {
      matched.route = true;
    }
  }

  return matched;
};

/**
 * @platform
 * @koa
 */
export class PlatformKoa implements PlatformAdapter<Koa, KoaRouter> {
  readonly providers = [
    {
      provide: PlatformResponse,
      useClass: PlatformKoaResponse
    },
    {
      provide: PlatformRequest,
      useClass: PlatformKoaRequest
    },
    {
      provide: PlatformHandler,
      useClass: PlatformKoaHandler
    }
  ];

  constructor(private injector: InjectorService) {}

  /**
   * Create new serverless application. In this mode, the component scan are disabled.
   * @param module
   * @param settings
   */
  static create(module: Type<any>, settings: Partial<TsED.Configuration> = {}) {
    return PlatformBuilder.create<Koa, KoaRouter>(module, {
      ...settings,
      adapter: PlatformKoa
    });
  }

  /**
   * Bootstrap a server application
   * @param module
   * @param settings
   */
  static async bootstrap(module: Type<any>, settings: Partial<TsED.Configuration> = {}) {
    return PlatformBuilder.bootstrap<Koa, KoaRouter>(module, {
      ...settings,
      adapter: PlatformKoa
    });
  }

  onInit() {
    const injector = this.injector;
    const app = this.getPlatformApplication();

    const listener: any = (error: any, ctx: Koa.Context) => {
      injector.get<PlatformExceptions>(PlatformExceptions)?.catch(error, ctx.request.$ctx);
    };

    app.getApp().silent = true;
    app.getApp().on("error", listener);
  }

  useRouter(): this {
    const app = this.injector.get<PlatformApplication<Koa>>(PlatformApplication)!;

    app.getApp().use(app.getRouter().routes()).use(app.getRouter().allowedMethods());

    return this;
  }

  useContext(): this {
    const app = this.getPlatformApplication();
    const invoke = createContext(this.injector);

    this.injector.logger.debug("Mount app context");

    app.getApp().use(async (koaContext: Context, next: Next) => {
      const $ctx = await invoke({
        request: koaContext.request as any,
        response: koaContext.response as any,
        koaContext
      });

      return runInContext($ctx, async () => {
        try {
          await $ctx.start();
          await next();
          const status = koaContext.status || 404;

          if (status === 404 && !$ctx.isDone()) {
            this.injector.get<PlatformExceptions>(PlatformExceptions)?.resourceNotFound($ctx);
          }
        } catch (error) {
          this.injector.get<PlatformExceptions>(PlatformExceptions)?.catch(error, $ctx);
        } finally {
          await $ctx.finish();
        }
      });
    });

    return this;
  }

  app() {
    const app = this.injector.settings.get("koa.app") || new Koa();
    koaQs(app, "extended");

    return {
      app,
      callback() {
        return app.callback();
      }
    };
  }

  router(routerOptions: any = {}) {
    const {settings} = this.injector;

    const options = Object.assign({}, settings.get("koa.router", {}), routerOptions);
    const router = new KoaRouter(options) as any;

    return {
      router,
      callback() {
        return [router.routes(), router.allowedMethods()];
      }
    };
  }

  multipart(options: PlatformMulterSettings): PlatformMulter {
    return getMulter(options);
  }

  statics(endpoint: string, options: PlatformStaticsOptions) {
    return staticsMiddleware(options);
  }

  bodyParser(type: "json" | "urlencoded" | "raw" | "text", additionalOptions: any = {}): any {
    const opts = this.injector.settings.get(`koa.bodyParser`);
    let parser: any = koaBodyParser;

    let options: Options = {};

    if (isFunction(opts)) {
      parser = opts;
      options = {};
    }

    return parser({...options, ...additionalOptions});
  }

  private getPlatformApplication() {
    return this.injector.get<PlatformApplication<Koa>>(PlatformApplication)!;
  }
}

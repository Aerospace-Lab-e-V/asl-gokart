// Phase-0 shim: the stable names other main modules import. W1 replaces this with the real adapter.
export {
    startSeroService as startSeroAdapter,
    stopSeroService as stopSeroAdapter,
    restartSeroService as restartSeroAdapter,
    sendOtaTrigger,
} from "@/helpers/ipc/sero/sero-service";

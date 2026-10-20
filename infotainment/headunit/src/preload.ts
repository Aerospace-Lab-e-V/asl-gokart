import exposeContexts from "./helpers/ipc/context-exposer";
import { exposeApi } from "./ipc/api";

exposeApi();
// TODO(integration): legacy window.* namespaces, deleted once every caller uses window.api.
exposeContexts();

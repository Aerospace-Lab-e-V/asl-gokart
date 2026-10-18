#pragma once
/// @file sero.hpp
/// Umbrella header — includes the entire Sero library.

#include "sero/core/log.hpp"
#include "sero/core/config.hpp"
#include "sero/core/types.hpp"
#include "sero/core/message_header.hpp"
#include "sero/security/crc16.hpp"
#include "sero/security/sha256.hpp"
#include "sero/security/hmac.hpp"
#include "sero/core/diagnostic_counters.hpp"
#include "sero/core/dtc_store.hpp"
#include "sero/core/transport.hpp"
#include "sero/service/service.hpp"
#include "sero/service/event_handler.hpp"
#include "sero/security/e2e_protection.hpp"
#include "sero/security/message_authenticator.hpp"
#include "sero/service/method_dispatcher.hpp"
#include "sero/service/event_manager.hpp"
#include "sero/service/request_tracker.hpp"
#include "sero/service/diagnostics_service.hpp"
#include "sero/service/service_discovery.hpp"
#include "sero/runtime.hpp"

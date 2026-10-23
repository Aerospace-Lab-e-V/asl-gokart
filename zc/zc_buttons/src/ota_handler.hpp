#pragma once
/// @file ota_handler.hpp
/// HTTP OTA firmware update helper for ESP32 zone controllers.
///
/// Receives a download URL from the headunit via a Sero method call and
/// performs the update using the esp_https_ota component (plain HTTP mode).
/// The update runs in a dedicated FreeRTOS task so that the Sero runtime
/// can send its E_OK acknowledgement before the device reboots.
///
/// Usage (inside impl_on_request):
///   char url[512];
///   memcpy(url, payload, payload_length);
///   url[payload_length] = '\0';
///   start_ota(url);
///   return sero::ReturnCode::E_OK;

#include <cstring>
#include <cstdlib>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include <HTTPClient.h>
#include <Update.h>

static const char* OTA_TAG = "ota";

// ── Internal task param ───────────────────────────────────────────────────────

struct OtaParams {
    char url[512];
};

// ── FreeRTOS OTA task ─────────────────────────────────────────────────────────

static void ota_task(void* pvParams) {
    OtaParams* params = static_cast<OtaParams*>(pvParams);

    // Give the main task some time to send the UDP acknowledgement
    vTaskDelay(pdMS_TO_TICKS(500));

    ESP_LOGI(OTA_TAG, "Starting OTA from: %s", params->url);

    HTTPClient http;
    http.begin(params->url);
    int httpCode = http.GET();

    if (httpCode == HTTP_CODE_OK) {
        int contentLength = http.getSize();
        bool canBegin = Update.begin(contentLength);
        if (canBegin) {
            WiFiClient *client = http.getStreamPtr();
            size_t written = Update.writeStream(*client);
            if (written == contentLength) {
                if (Update.end()) {
                    ESP_LOGI(OTA_TAG, "OTA succeeded — rebooting");
                    free(params);
                    esp_restart();
                } else {
                    ESP_LOGE(OTA_TAG, "Update end failed: %s", Update.errorString());
                }
            } else {
                ESP_LOGE(OTA_TAG, "Written only %d / %d bytes", written, contentLength);
            }
        } else {
            ESP_LOGE(OTA_TAG, "Not enough space to begin OTA");
        }
    } else {
        ESP_LOGE(OTA_TAG, "HTTP GET failed, code: %d", httpCode);
    }
    
    http.end();
    free(params);
    vTaskDelete(nullptr);
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Spawn the OTA task with the given firmware URL.
/// @param url  Null-terminated HTTP URL (e.g. "http://10.77.0.100:8080/firmware/...")
/// @return true if the task was created successfully.
static bool start_ota(const char* url) {
    if (!url || url[0] == '\0') {
        ESP_LOGE(OTA_TAG, "start_ota: empty URL");
        return false;
    }

    OtaParams* params = static_cast<OtaParams*>(malloc(sizeof(OtaParams)));
    if (!params) {
        ESP_LOGE(OTA_TAG, "start_ota: malloc failed");
        return false;
    }

    strncpy(params->url, url, sizeof(params->url) - 1);
    params->url[sizeof(params->url) - 1] = '\0';

    BaseType_t created = xTaskCreate(
        ota_task,
        "ota_task",
        8192,
        params,
        5,
        nullptr
    );

    if (created != pdPASS) {
        ESP_LOGE(OTA_TAG, "start_ota: xTaskCreate failed");
        free(params);
        return false;
    }

    return true;
}

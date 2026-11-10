package api

import "net/http"

// ClientConfig is the part of the plugin settings every signed-in user may read.
type ClientConfig struct {
	DefaultEventDurationMinutes int `json:"defaultEventDurationMinutes"`
}

// SetClientConfig sets the source of the settings served by GET /api/v1/config.
func (h *Handler) SetClientConfig(config func() ClientConfig) {
	h.config = config
}

func (h *Handler) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	config := ClientConfig{DefaultEventDurationMinutes: 60}
	if h.config != nil {
		config = h.config()
	}
	writeJSON(w, r, http.StatusOK, config)
}

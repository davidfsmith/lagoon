# Hove Lagoon — PWA

Read-only companion: your bookings, membership, ride-pass tokens, and a weather-aware
availability agenda for Tech/Air 30 wakeboarding sessions. Static, no build step.

## Run
    cd app && python3 -m http.server 8077
    # open http://localhost:8077, sign in with your Lagoon account

## Test
    cd app && node --test

## Design
See ../docs/superpowers/specs/2026-06-14-lagoon-pwa-design.md

Booking is deep-linked to booking.lagoon.co.uk in v1; in-app (no-payment) booking is a
later phase. No card payments, ever.

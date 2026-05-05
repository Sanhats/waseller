#!/usr/bin/env bash
TENANT_ID="9316c0de-75d1-4c85-9808-ad4163e6fa31"
TS=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
RID=$RANDOM
echo "TENANT_ID=$TENANT_ID"
echo "TS=$TS"
echo "RID=$RID"
echo "---"
curl -i -X POST "https://waseller-dashboard.vercel.app/api/messages/incoming" \
  -H "x-tenant-id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"5491140009999\",\"message\":\"test desde curl\",\"timestamp\":\"$TS\",\"externalMessageId\":\"test-$RID\"}"
echo

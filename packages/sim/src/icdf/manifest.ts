/**
 * ICDF table checksums — GENERATED. Do not edit by hand.
 * Regenerate with: npx tsx packages/sim/tools/gen-icdf-manifest.ts
 *
 * Exists as a .ts module rather than a .json file so it needs no resolveJsonModule, no
 * copy step into dist/, and no filesystem read at runtime.
 */
export interface ICDFManifestEntry {
  readonly hash: string;
  readonly params: Record<string, number>;
}

export const ICDF_MANIFEST: Readonly<Record<string, ICDFManifestEntry>> = {
  "default_fast": {
    "hash": "1278a85c19edba05fb9d82745179e28d03d42742b0ecb6409561992be45b036f",
    "params": {
      "meanUs": 5000,
      "size": 4096
    }
  },
  "default_lognormal": {
    "hash": "438b527e18c20fbe7a546c52ad234b9eaf9101900b6bcbc914ea03e427c06298",
    "params": {
      "medianUs": 30000,
      "sigma": 0.5,
      "size": 4096
    }
  },
  "default_normal": {
    "hash": "14a2a69eae478ef0d5b799b375df5063f0444bb809fdecd6fbabd83bbebf8c2a",
    "params": {
      "meanUs": 50000,
      "stdDevUs": 10000,
      "minUs": 5000,
      "size": 4096
    }
  },
  "default_service": {
    "hash": "6b1eca4e977cf7e8e7624ec85807e3b080ba46cf43340591ef8884bb308b42a2",
    "params": {
      "meanUs": 20000,
      "size": 4096
    }
  },
  "degraded_tail": {
    "hash": "265a64b2e70a3347538cf23fbec3f305a5a5fe90089869973d0f57ba6282aec6",
    "params": {
      "healthyMeanUs": 20000,
      "tailMeanUs": 900000,
      "tailProbability": 0.1,
      "size": 4096
    }
  },
  "interarrival_1s": {
    "hash": "d46e9068cabcb6a387307058749408f5b530e4c5c259311bb8df303cb8f680a8",
    "params": {
      "meanUs": 1000000,
      "size": 4096
    }
  }
} as const;

package com.donefear.goodstock;

import android.annotation.TargetApi;
import android.app.Activity;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

/**
 * Product barcodes (EAN and UPC) through Google's code scanner. It runs in Google Play services, so the app needs no
 * camera permission. Kept in its own class so Android 4.4, which cannot load the library, never touches it.
 */
@TargetApi(21)
final class BarcodeScan {
    interface Result {
        void done(boolean ok, String value);
    }

    private BarcodeScan() {}

    static void start(Activity activity, Result result) {
        try {
            GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
                    .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E)
                    .enableAutoZoom()
                    .build();
            GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(activity, options);
            scanner.startScan()
                    .addOnSuccessListener(barcode -> result.done(true, barcode.getRawValue() == null ? "" : barcode.getRawValue()))
                    .addOnCanceledListener(() -> result.done(false, "cancelled"))
                    .addOnFailureListener(error -> result.done(false, error.getMessage() == null ? "The scanner could not start" : error.getMessage()));
        } catch (RuntimeException error) {
            result.done(false, "The scanner is not available on this phone");
        }
    }
}

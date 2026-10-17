package com.donefear.goodstock;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Hosting the kitchen (see app/sync.js): a small home server on the Wi-Fi with the kitchen API of server.mjs, so other
 * phones connect to this one under Home server. GET /api/state, GET /api/state/revision and POST /api/state (409 when
 * another device saved first) need the household token, which /api/auth/login gives for the PIN shown on this phone.
 * The kitchen is kept in a file so it survives a restart. Mirrors createKitchenHost in desktop/native.js.
 */
final class KitchenHost {
    private static final String PREFS = "goodstock-kitchen-host";
    private static final int[] PORTS = {8486, 8487, 8488, 8489, 8490};
    private static final int MAX_BODY = 20_000_000;
    private static final long DEVICE_SEEN_MS = 45_000;
    private static KitchenHost running;

    private final File file;
    private final String pin;
    private final String token;
    private final ServerSocket socket;
    private final ExecutorService workers = Executors.newFixedThreadPool(4);
    private final Map<String, Long> devices = new HashMap<>();
    private int revision;
    private String state;
    private int wrongPins;
    private long lockedUntil;

    private KitchenHost(Context context, String pin, String token) throws Exception {
        this.file = new File(context.getFilesDir(), "host-kitchen.json");
        this.pin = pin;
        this.token = token;
        load();
        ServerSocket opened = null;
        for (int port : PORTS) {
            try {
                ServerSocket candidate = new ServerSocket();
                candidate.setReuseAddress(true);
                candidate.bind(new InetSocketAddress(port));
                opened = candidate;
                break;
            } catch (Exception ignored) {
                // Try the next port.
            }
        }
        if (opened == null) throw new IllegalStateException("No free port for hosting");
        socket = opened;
        Thread accept = new Thread(this::acceptLoop, "goodstock-host");
        accept.setDaemon(true);
        accept.start();
    }

    /** Starts the host (or keeps the running one) and answers {port, addresses, pin, token} as JSON. */
    static synchronized String start(Context context) throws Exception {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String pin = prefs.getString("pin", null);
        String token = prefs.getString("token", null);
        if (pin == null || token == null) {
            SecureRandom random = new SecureRandom();
            pin = String.format(Locale.ROOT, "%06d", random.nextInt(1_000_000));
            byte[] bytes = new byte[24];
            random.nextBytes(bytes);
            StringBuilder hex = new StringBuilder();
            for (byte value : bytes) hex.append(String.format(Locale.ROOT, "%02x", value));
            token = hex.toString();
            prefs.edit().putString("pin", pin).putString("token", token).apply();
        }
        if (running == null) running = new KitchenHost(context.getApplicationContext(), pin, token);
        JSONArray addresses = new JSONArray();
        for (String address : lanAddresses()) addresses.put(address);
        return new JSONObject().put("port", running.socket.getLocalPort()).put("addresses", addresses).put("pin", pin).put("token", token).toString();
    }

    /** Stops hosting and forgets the PIN, token and kitchen; the next start is a new household link. */
    static synchronized void stop(Context context) {
        if (running != null) {
            try { running.socket.close(); } catch (Exception ignored) { /* Already closed. */ }
            running.workers.shutdownNow();
            running = null;
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        //noinspection ResultOfMethodCallIgnored
        new File(context.getFilesDir(), "host-kitchen.json").delete();
    }

    private static java.util.List<String> lanAddresses() {
        java.util.List<String> found = new java.util.ArrayList<>();
        try {
            for (NetworkInterface face : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!face.isUp() || face.isLoopback()) continue;
                for (InetAddress address : Collections.list(face.getInetAddresses())) {
                    if (address instanceof Inet4Address && address.isSiteLocalAddress()) found.add(address.getHostAddress());
                }
            }
        } catch (Exception ignored) {
            // No network: the page says so.
        }
        return found;
    }

    private synchronized void load() {
        try (InputStream in = new FileInputStream(file)) {
            JSONObject saved = new JSONObject(new String(readAll(in, MAX_BODY * 2), StandardCharsets.UTF_8));
            JSONObject kitchen = saved.optJSONObject("state");
            if (kitchen != null && kitchen.optJSONArray("inventory") != null) {
                state = kitchen.toString();
                revision = Math.max(1, saved.optInt("revision", 1));
            }
        } catch (Exception ignored) {
            // A new host starts empty; the first device to save fills it.
        }
    }

    private void save(String snapshot) {
        File temporary = new File(file.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(temporary)) {
            out.write(snapshot.getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        temporary.renameTo(file);
    }

    private void acceptLoop() {
        while (!socket.isClosed()) {
            try {
                Socket client = socket.accept();
                workers.execute(() -> serve(client));
            } catch (Exception ignored) {
                // Closed when hosting stops.
            }
        }
    }

    private static byte[] readAll(InputStream in, int limit) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16_384];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
            if (out.size() > limit) throw new IllegalStateException("Too large");
        }
        return out.toByteArray();
    }

    private static String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int value;
        while ((value = in.read()) != -1 && value != '\n') {
            if (value != '\r') line.write(value);
            if (line.size() > 16_384) throw new IllegalStateException("Line too long");
        }
        if (value == -1 && line.size() == 0) return null;
        return new String(line.toByteArray(), StandardCharsets.UTF_8);
    }

    private void serve(Socket client) {
        try (Socket connection = client) {
            connection.setSoTimeout(20_000);
            InputStream in = new BufferedInputStream(connection.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
            }
            int length = 0;
            try { length = Integer.parseInt(headers.containsKey("content-length") ? headers.get("content-length") : "0"); } catch (NumberFormatException ignored) { /* No body. */ }
            if (length < 0 || length > MAX_BODY) { respond(connection, 413, "{\"error\":\"Too large\"}"); return; }
            byte[] body = new byte[length];
            int offset = 0;
            while (offset < length) {
                int read = in.read(body, offset, length - offset);
                if (read == -1) break;
                offset += read;
            }
            String path = parts[1].split("\\?")[0];
            String[] answer = handle(parts[0].toUpperCase(Locale.ROOT), path, headers.get("authorization"), headers.get("x-goodstock-client"), new String(body, 0, offset, StandardCharsets.UTF_8));
            respond(connection, Integer.parseInt(answer[0]), answer[1]);
        } catch (Exception ignored) {
            // The device tries again.
        }
    }

    private static void respond(Socket connection, int status, String json) throws Exception {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + " " + (status == 200 ? "OK" : "Error") + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n"
                + "Content-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n";
        OutputStream out = connection.getOutputStream();
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        out.write(bytes);
        out.flush();
    }

    /** Answers {status, json body}. */
    private synchronized String[] handle(String method, String path, String authorization, String client, String body) throws Exception {
        String route = method + " " + path;
        long now = System.currentTimeMillis();
        if (route.equals("GET /api/health")) return new String[]{"200", "{\"ok\":true,\"app\":\"goodstock\",\"host\":true}"};
        if (route.equals("POST /api/auth/login")) {
            if (now < lockedUntil) return new String[]{"429", "{\"error\":\"Too many wrong PINs.\"}"};
            String given = "";
            try { given = new JSONObject(body.isEmpty() ? "{}" : body).optString("pin", ""); } catch (Exception ignored) { /* Wrong below. */ }
            if (!pin.equals(given)) {
                wrongPins += 1;
                if (wrongPins >= 5) { wrongPins = 0; lockedUntil = now + 5 * 60_000; }
                return new String[]{"401", "{\"error\":\"Wrong PIN\"}"};
            }
            wrongPins = 0;
            return new String[]{"200", new JSONObject().put("token", token).toString()};
        }
        if (!("Bearer " + token).equals(authorization)) return new String[]{"401", "{\"error\":\"PIN required\",\"code\":\"pin\"}"};
        // Devices are told apart by the id each app sends; the revision answer counts the others than the one asking.
        String id = client == null ? "" : client;
        if (!id.isEmpty()) devices.put(id, now);
        if (route.equals("GET /api/state")) {
            if (state == null) return new String[]{"200", "null"};
            return new String[]{"200", new JSONObject(state).put("_revision", revision).toString()};
        }
        if (route.equals("GET /api/state/revision")) {
            Iterator<Map.Entry<String, Long>> seen = devices.entrySet().iterator();
            while (seen.hasNext()) if (now - seen.next().getValue() > DEVICE_SEEN_MS) seen.remove();
            int others = devices.size() - (devices.containsKey(id) ? 1 : 0);
            return new String[]{"200", new JSONObject().put("revision", revision).put("devices", others).toString()};
        }
        if (route.equals("POST /api/state")) {
            JSONObject payload;
            try { payload = new JSONObject(body); } catch (Exception error) { return new String[]{"400", "{\"error\":\"Invalid kitchen state\"}"}; }
            JSONObject incoming = payload.optJSONObject("state");
            if (incoming == null || incoming.optJSONArray("inventory") == null || incoming.optJSONArray("recipes") == null) {
                return new String[]{"400", "{\"error\":\"Invalid kitchen state\"}"};
            }
            if (state != null && payload.optInt("baseRevision", -1) != revision) {
                return new String[]{"409", new JSONObject().put("error", "The kitchen changed on another device.").put("revision", revision).put("state", new JSONObject(state)).toString()};
            }
            incoming.remove("_revision");
            state = incoming.toString();
            revision += 1;
            save(new JSONObject().put("revision", revision).put("state", incoming).toString());
            return new String[]{"200", new JSONObject().put("saved", true).put("revision", revision).toString()};
        }
        return new String[]{"404", "{\"error\":\"Not found\"}"};
    }
}

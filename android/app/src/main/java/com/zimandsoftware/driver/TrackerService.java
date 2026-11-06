package com.zimandsoftware.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Urmărirea poziţiei şoferului, făcută NATIV (05.11.2026).
 *
 * Partea web a aplicaţiei e oprită de Android când aplicaţia e în fundal
 * (navigaţia pe ecran, ecran stins) — iar poziţia se trimitea tocmai de acolo.
 * Serviciul acesta rulează în prim-plan (cu notificarea „Standort aktiv") şi
 * trimite poziţia direct la funcţia de server `driver-location`, cu cheia de
 * urmărire a şoferului. Nu depinde deloc de partea web.
 *
 * Ritm (06.11.2026, v16):
 *  - normal: o poziţie la 30 s, şi pe loc (ca Disponent să vadă că merge);
 *  - rapid, cât cineva îl urmăreşte live în Disponent (serverul răspunde
 *    "rapid":true): la ~3 s, după minim 5 m — harta se mişcă fluent.
 * Se opreşte singur când serverul răspunde că şoferul e offline.
 */
public class TrackerService extends Service {
    static final String PREFS = "zimand_tracker";
    static final String CHANNEL = "zimand_tracking";
    static final int NOTIF_ID = 4711;

    private FusedLocationProviderClient client;
    private LocationCallback callback;
    private final ExecutorService net = Executors.newSingleThreadExecutor();

    private Location ultimaTrimisa = null;
    private long ultimaTrimisaLa = 0;
    private volatile boolean rapid = false;
    private boolean cerereRapida = false;

    static void porneste(Context ctx, String url, String token) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString("url", url).putString("token", token).putBoolean("activ", true).apply();
        Intent i = new Intent(ctx, TrackerService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    static void opreste(Context ctx) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("activ", false).apply();
        ctx.stopService(new Intent(ctx, TrackerService.class));
    }

    static boolean activ(Context ctx) {
        return ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("activ", false);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!p.getBoolean("activ", false) || p.getString("token", null) == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        pornesteInPrimPlan();
        if (callback == null) cereLocatii();
        // Dacă Android opreşte serviciul, îl reporneşte singur.
        return START_STICKY;
    }

    private void pornesteInPrimPlan() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Standort", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Standortfreigabe für die Disposition, solange Sie online sind");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent deschide = new Intent(this, MainActivity.class);
        deschide.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, deschide,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Zimand Driver")
            .setContentText("Standort aktiv – die Disposition sieht Ihre Position.")
            .setSmallIcon(R.drawable.ic_stat_zimand)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private void cereLocatii() {
        if (client == null) client = LocationServices.getFusedLocationProviderClient(this);
        if (callback == null) {
            callback = new LocationCallback() {
                @Override
                public void onLocationResult(LocationResult r) {
                    Location l = r.getLastLocation();
                    if (l != null) poateTrimite(l);
                }
            };
        } else {
            client.removeLocationUpdates(callback);
        }
        cerereRapida = rapid;
        // Fără prag de distanţă şi fără grupare (batching): poziţiile vin la timp,
        // iar pragurile le aplicăm noi în poateTrimite().
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, rapid ? 2000 : 10000)
            .setMinUpdateIntervalMillis(rapid ? 1000 : 5000)
            .setMinUpdateDistanceMeters(0)
            .build();
        try {
            client.requestLocationUpdates(req, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            // Fără permisiunea de locaţie nu avem ce face; partea web o va cere din nou.
            stopSelf();
        }
    }

    private void poateTrimite(Location l) {
        long acum = System.currentTimeMillis();
        if (ultimaTrimisa != null) {
            long dt = acum - ultimaTrimisaLa;
            float dist = ultimaTrimisa.distanceTo(l);
            boolean trimite = rapid
                ? (dt >= 2500 && dist >= 5) || dt >= 30000
                : dt >= 30000;
            if (!trimite) return;
        }
        ultimaTrimisa = l;
        ultimaTrimisaLa = acum;
        final double lat = l.getLatitude(), lng = l.getLongitude();
        final Float speed = l.hasSpeed() ? l.getSpeed() : null;
        final Float heading = l.hasBearing() ? l.getBearing() : null;
        final Float acc = l.hasAccuracy() ? l.getAccuracy() : null;
        net.execute(() -> trimite(lat, lng, speed, heading, acc));
    }

    private void trimite(double lat, double lng, Float speed, Float heading, Float acc) {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        String url = p.getString("url", null), token = p.getString("token", null);
        if (url == null || token == null) return;
        HttpURLConnection c = null;
        try {
            JSONObject b = new JSONObject();
            b.put("t", token);
            b.put("lat", lat);
            b.put("lng", lng);
            if (speed != null) b.put("speed", speed.doubleValue());
            if (heading != null) b.put("heading", heading.doubleValue());
            if (acc != null) b.put("acc", acc.doubleValue());
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = c.getOutputStream()) {
                os.write(b.toString().getBytes(StandardCharsets.UTF_8));
            }
            int cod = c.getResponseCode();
            if (cod == 200) {
                try (InputStream is = c.getInputStream(); Scanner s = new Scanner(is, "UTF-8").useDelimiter("\\A")) {
                    String raspuns = s.hasNext() ? s.next() : "";
                    // Şoferul a trecut pe offline (sau cheia nu mai e valabilă): ne oprim.
                    if (raspuns.contains("\"stop\":true")) { opreste(this); return; }
                    // Cineva îl urmăreşte live? Schimbăm ritmul (pe firul principal).
                    boolean nou = raspuns.contains("\"rapid\":true");
                    if (nou != rapid) {
                        rapid = nou;
                        new android.os.Handler(Looper.getMainLooper()).post(() -> {
                            if (callback != null && cerereRapida != rapid) cereLocatii();
                        });
                    }
                }
            }
        } catch (Exception e) {
            // Fără semnal: următoarea poziţie încearcă din nou.
        } finally {
            if (c != null) c.disconnect();
        }
    }

    @Override
    public void onDestroy() {
        if (client != null && callback != null) client.removeLocationUpdates(callback);
        callback = null;
        net.shutdown();
        super.onDestroy();
    }
}

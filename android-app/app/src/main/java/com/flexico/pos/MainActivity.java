package com.flexico.pos;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.graphics.Color;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Flexico Android companion: UI for an already running HTTPS-hosted POS server.
 * The local SQLite/Node cashier backend is NOT bundled in this APK.
 * Android offline standalone checkout is NOT supported.
 */
public final class MainActivity extends Activity {
    private static final String PREF = "flexico_companion";
    private static final int FILE_REQUEST = 401;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri allowedOrigin;
    private String baseUrl;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(27,29,25));
        getWindow().setNavigationBarColor(Color.rgb(27,29,25));
        baseUrl = getPreferences(MODE_PRIVATE).getString("endpoint", "");
        if (validHttps(baseUrl)) showWeb(); else showServerSetup();
    }

    private boolean validHttps(String candidate) {
        try {
            Uri u = Uri.parse(candidate.trim());
            return "https".equalsIgnoreCase(u.getScheme())
                && u.getHost() != null && !u.getHost().isEmpty()
                && (u.getEncodedAuthority()==null || !u.getEncodedAuthority().contains("@"));
        } catch (Exception e) { return false; }
    }

    private void showServerSetup() {
        if (web != null) { web.destroy(); web = null; }
        allowedOrigin = null;
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setPadding(dp(30),dp(45),dp(30),dp(25));
        wrap.setBackgroundColor(Color.rgb(251,249,243));
        TextView headline = new TextView(this);
        headline.setText("FLEXICO  /  POS");
        headline.setTextColor(Color.rgb(36,37,31));
        headline.setTextSize(25); headline.setGravity(Gravity.CENTER_HORIZONTAL);
        wrap.addView(headline);
        TextView explanation = new TextView(this);
        explanation.setText("Connect to your authorized HTTPS POS server. The server must be deployed and reachable before this app can log in. This Android companion does not store sales offline.");
        explanation.setTextSize(14); explanation.setPadding(0,dp(30),0,dp(20));
        wrap.addView(explanation);
        EditText entry = new EditText(this);
        entry.setSingleLine(true);entry.setInputType(17);
        entry.setText(baseUrl);entry.setHint("https://pos.yourdomain.com/");
        wrap.addView(entry);
        Button connect = new Button(this); connect.setText("Connect securely");
        wrap.addView(connect);
        connect.setOnClickListener(v -> {
            String input = entry.getText().toString().trim();
            if (!validHttps(input)) {
                entry.setError("An HTTPS address is required (no HTTP).");
                return;
            }
            baseUrl = input.endsWith("/") ? input : input+"/";
            getPreferences(MODE_PRIVATE).edit().putString("endpoint",baseUrl).apply();
            showWeb();
        });
        setContentView(wrap);
    }

    private boolean sameTrustedOrigin(Uri requested) {
        return allowedOrigin != null
          && "https".equalsIgnoreCase(requested.getScheme())
          && allowedOrigin.getHost().equalsIgnoreCase(requested.getHost())
          && allowedOrigin.getPort() == requested.getPort();
    }

    private void showWeb() {
        allowedOrigin = Uri.parse(baseUrl);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(251,249,243));
        WebSettings cfg = web.getSettings();
        cfg.setJavaScriptEnabled(true);
        cfg.setDomStorageEnabled(true);
        cfg.setAllowFileAccess(false);
        cfg.setAllowContentAccess(false);
        cfg.setJavaScriptCanOpenWindowsAutomatically(false);
        cfg.setSupportMultipleWindows(false);
        cfg.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (android.os.Build.VERSION.SDK_INT>=26)cfg.setSafeBrowsingEnabled(true);
        cfg.setAllowFileAccessFromFileURLs(false);
        cfg.setAllowUniversalAccessFromFileURLs(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (sameTrustedOrigin(request.getUrl())) return false;
                // Explicit external URLs leave the authenticated POS WebView.
                try { startActivity(new Intent(Intent.ACTION_VIEW,request.getUrl())); }
                catch(Exception e){ Toast.makeText(MainActivity.this,"External link unavailable",Toast.LENGTH_SHORT).show(); }
                return true;
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error) {
                handler.cancel();
                Toast.makeText(MainActivity.this,"TLS certificate error — connection blocked",Toast.LENGTH_LONG).show();
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest req,WebResourceError error) {
                if(req.isForMainFrame())Toast.makeText(MainActivity.this,"POS server unreachable. No transactions can be made here.",Toast.LENGTH_LONG).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent chooser = new Intent(Intent.ACTION_GET_CONTENT);
                chooser.addCategory(Intent.CATEGORY_OPENABLE);
                chooser.setType("image/*");
                try { startActivityForResult(Intent.createChooser(chooser,"Select product image"), FILE_REQUEST); }
                catch(ActivityNotFoundException e) { fileCallback.onReceiveValue(null); fileCallback=null; return false; }
                return true;
            }
        });
        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setBackgroundColor(Color.rgb(251,249,243));
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(12),0,dp(12),0);
        header.setBackgroundColor(Color.rgb(27,29,25));
        TextView brand = new TextView(this);
        brand.setText("FLEXICO  ·  POS");
        brand.setTextColor(Color.rgb(226,198,144));
        brand.setTextSize(15);
        brand.setTypeface(null,1);
        header.addView(brand,new LinearLayout.LayoutParams(0,dp(48),1));
        brand.setGravity(Gravity.CENTER_VERTICAL);
        Button change = new Button(this);
        change.setText("Server");
        change.setTextSize(11);
        header.addView(change,new LinearLayout.LayoutParams(dp(78),dp(48)));
        change.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("Change POS server?")
          .setMessage("Only connect to an approved HTTPS POS server. You will leave the current page.")
          .setNegativeButton("Cancel",(d,w)->{})
          .setPositiveButton("Change",(d,w)->showServerSetup()).show());
        Button refresh = new Button(this);
        refresh.setText("↻");
        header.addView(refresh,new LinearLayout.LayoutParams(dp(48),dp(48)));
        refresh.setOnClickListener(v -> web.reload());
        screen.addView(header);
        screen.addView(web,new LinearLayout.LayoutParams(-1,0,1));
        setContentView(screen);
        web.loadUrl(baseUrl);
    }

    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==FILE_REQUEST && fileCallback!=null) {
            Uri[] answer = resultCode==RESULT_OK && data!=null && data.getData()!=null ? new Uri[]{data.getData()} : null;
            fileCallback.onReceiveValue(answer);fileCallback=null;
        }
    }
    @Override public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0,1,0,"Change server");
        menu.add(0,2,1,"Reload POS");
        return true;
    }
    @Override public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId()==1) {
            new AlertDialog.Builder(this).setTitle("Change server?").setMessage("Use only your organization's approved HTTPS address.")
              .setNegativeButton("Cancel",(d,w)->{})
              .setPositiveButton("Change",(d,w)->showServerSetup()).show();
            return true;
        }
        if(item.getItemId()==2){if(web!=null)web.reload();return true;}
        return super.onOptionsItemSelected(item);
    }
    @Override public void onBackPressed() {
        if(web!=null && web.canGoBack())web.goBack();else super.onBackPressed();
    }
    private int dp(int v){return (int)(v*getResources().getDisplayMetrics().density+.5f);}
}

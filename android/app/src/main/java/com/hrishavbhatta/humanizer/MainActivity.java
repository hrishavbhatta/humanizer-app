package com.hrishavbhatta.humanizer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin for the optional AI model file (download, resume, cancel, delete).
        registerPlugin(ModelFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

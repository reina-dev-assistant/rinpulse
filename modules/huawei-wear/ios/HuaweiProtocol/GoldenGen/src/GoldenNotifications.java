import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Notifications;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Notifications (service 0x02): the watch-side switch request, built by the real Java class, and the per-app switch list 02/0B.
 * Gadgetbridge has no class for 02/0B (it filters on the phone), so that packet is built here with the real HuaweiTLV encoder the way
 * Huawei Health's own sender lays it out: 81 { 82 { 03 app id, 04 byte } ... }.
 */
public class GoldenNotifications {
    /** 02/0B, built the way Huawei Health 17.0.8.300 (`nlz.sendAllSubSwitchStatusToDevice`) does. */
    static class AppSwitchesRequest extends HuaweiPacket {
        AppSwitchesRequest(HuaweiPacket.ParamsProvider paramsProvider, String[] ids, int[] values) {
            super(paramsProvider);
            this.serviceId = Notifications.id;
            this.commandId = 0x0B;
            HuaweiTLV list = new HuaweiTLV();
            for (int i = 0; i < ids.length; i++) {
                list.put(0x82, new HuaweiTLV().put(0x03, ids[i]).put(0x04, (byte) values[i]));
            }
            this.tlv = new HuaweiTLV().put(0x81, list);
            this.complete = true;
        }
    }

    static JSONObject appSwitches(String name, String[] ids, int[] values) throws Exception {
        JSONObject o = PacketsGoldenKit.request(name, new AppSwitchesRequest(PacketsGoldenKit.params(), ids, values));
        JSONArray entries = GoldenSupport.arr();
        for (int i = 0; i < ids.length; i++) entries.put(GoldenSupport.obj().put("appId", ids[i]).put("value", values[i]));
        o.put("entries", entries);
        return o;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        JSONArray requests = GoldenSupport.arr();
        for (boolean on : new boolean[] {true, false}) {
            JSONObject o = PacketsGoldenKit.request("NotificationState " + on, new Notifications.NotificationStateRequest(PacketsGoldenKit.params(), on));
            o.put("enabled", on);
            requests.put(o);
        }
        root.put("requests", requests);

        JSONArray switches = GoldenSupport.arr();
        // The research document's example: 28 plaintext bytes for com.apple.MobileSMS with the value 1.
        switches.put(appSwitches("one app, value 1", new String[] {"com.apple.MobileSMS"}, new int[] {1}));
        switches.put(appSwitches("one app, value 0", new String[] {"com.apple.MobileSMS"}, new int[] {0}));
        switches.put(appSwitches("one app, Huawei's appid number", new String[] {"1"}, new int[] {1}));
        switches.put(appSwitches("two apps", new String[] {"net.whatsapp.WhatsApp", "ph.telegra.Telegraph"}, new int[] {0, 1}));
        // A list long enough for a two-byte TLV length and several frames.
        String[] ids = new String[24];
        int[] values = new int[24];
        for (int i = 0; i < ids.length; i++) {
            ids[i] = "com.example.application.number" + i;
            values[i] = i % 2;
        }
        switches.put(appSwitches("24 apps, sliced over several frames", ids, values));
        root.put("appSwitches", switches);
        GoldenSupport.write(args[0], "notifications.json", root);
    }
}

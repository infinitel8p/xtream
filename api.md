# Xtream Codes API Reference

### Parameters
- **username** → `<user>` (ex: `Mike`)  
- **password** → `<pwd>` (ex: `1234`)  
- **base_url** → `<url>` (ex: `http://xtreamcode.ex`)  

---

## Get Whole Streams M3U (get.php)

**Request**  
```
<url>/get.php?username=<user>&password=<pwd>&type=m3u_plus&output=ts
```

**Example**  
```
http://xtreamcode.ex/get.php?username=Mike&password=1234&type=m3u_plus&output=ts
```

---

## Lives (player_api.php)

### Get All Live Streams
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_live_streams
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_live_streams
```

### Get Live Categories
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_live_categories
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_live_categories
```

### Get Streams of a Specific Live Category
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_live_streams&category_id=<X>
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_live_streams&category_id=25
```

---

## Movies (VOD)

### Get All VOD Streams
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_vod_streams
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_vod_streams
```

### Get VOD Categories
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_vod_categories
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_vod_categories
```

### Get VOD by Category
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_vod_streams&category_id=<X>
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_vod_streams&category_id=4526
```

### Get VOD Info
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_vod_info&vod_id=<X>
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_vod_info&vod_id=999
```

---

## Series

### Get All Series
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_series
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_series
```

### Get Series Categories
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_series_categories
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_series_categories
```

### Get Series by Category
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_series&category_id=<X>
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_series&category_id=214
```

### Get Series Info
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_series_info&series=<X>
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_series_info&series=865421
```

---

## EPG (xmltv.php / player_api.php)

### Full EPG (All Streams)
```
<url>/xmltv.php?username=<user>&password=<pwd>
```
Example:  
```
http://xtreamcode.ex/xmltv.php?username=Mike&password=1234
```

### Short EPG (Specific Live Stream)
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_short_epg&stream_id=<X>&limit=<N>
```
(Default limit = 4)  

Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_short_epg&stream_id=55555
```

### Full EPG (Specific Live Stream)
```
<url>/player_api.php?username=<user>&password=<pwd>&action=get_simple_date_table&stream_id=<X>
```
Example:  
```
http://xtreamcode.ex/player_api.php?username=Mike&password=1234&action=get_simple_date_table&stream_id=55555
```

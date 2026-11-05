<?php
ob_end_flush();
ini_set("zlib.output_compression", "off");
error_reporting(E_ALL);
ini_set("display_errors", "1");
defined("BASEPATH") or exit("No direct script access allowed");
$id = $_POST["id"];
$this->db->where("id", $id);
$bannerData = $this->db->get("BannerImages")->row_array();
if (!empty($bannerData) && $bannerData["apilink"] == "2025Recap") {
    $this->db->where("user_id", $_POST["userid"]);
    $userInfo = $this->db->get("Tile_Users")->row_array();
    $mcode = $userInfo["Mcode"];

    $this->db->where("M_Code", $mcode);
    $videoData = $this->db->get("recap_2025")->row_array();
    if ($videoData) {
        banneranalytics(
            $this,
            $_POST["userid"],
            $videoData["link"],
            $bannerData["name"],
            $bannerData["type"]
        );
        echo $videoData["link"];
    } else {
        echo "Video Not Avalable";
    }
    exit();
}

// Pirsonal API configuration
$accountID = "5fb8c856c0224f49a732a43a";
$accountSecret = "zwje7rSCb4_I66o86GJmBUAMW67reCW6YltfJA9s45U=";

// Initialize Barrister for API interaction
require_once "barrister.php";
$barrister = new Barrister();
$client = $barrister->httpClient(
    "https://dev2.pirsonal.com/api?" .
        "accountID=" .
        $accountID .
        "&accountSecret=" .
        $accountSecret
);
$pirsonal = $client->proxy("PirsonalAPI");
// echo "<pre>";print_r($pirsonal);exit();

if ($this->input->post("link")) {
    $link = $this->input->post("link");
    $userid = $this->input->post("userid");
    if (image_editor_link($link)) {
        $name = strtoupper((string) $this->input->post("name"));
        $phone = $this->input->post("phone");
        $editorType = image_editor_is_video($link) ? "VIDEO" : "IMAGE";
        $out = image_editor_response_url($link, $editorType, $name, $phone);
        if ($out === null) {
            echo "Banner not created Yet";
            exit();
        }
        banneranalytics($this, $userid, $out, $link, $editorType);
        echo $out;
        exit();
    }
    $query = $this->db->where("template_id", $link);
    $query = $this->db->where("user_id", $userid);
    $query = $this->db->get("user_videos");
    $dataCount = $query->num_rows();
    if ($dataCount > 0) {
        $Olddata = $query->row_array();
        $video_id = $Olddata["video_id"];
        if ($Olddata["video_url"] == null || $Olddata["video_url"] == "") {
            $videoData = $videolink = $pirsonal->Video_Get_Links($video_id);
            if (count($videoData) > 0) {
                $linkUrl = $videoData[0]["url"] ?? null;
                $udata["video_url"] = $linkUrl;
                $this->db->where("template_id", $link);
                $this->db->where("user_id", $userid);
                $this->db->update("user_videos", $udata);
            }
        } else {
            $linkUrl = $Olddata["video_url"];
        }
        if ($linkUrl) {
            banneranalytics($this, $userid, $linkUrl, $link, "VIDEO");
            echo $linkUrl;
            exit();
            // echo "ck".$linkUrl;exit();
        }
    }
} else {
    $id = $this->input->post("id");

    $userid = $this->input->post("userid");

    $query = $this->db->get_where("BannerImages", ["id" => $id]);

    foreach ($query->result() as $row) {
        // echo "<pre>";print_r($row);exit();
        $link = $row->apilink;
        $thumblink = $row->thumblink;
        $bannername = $row->name;
        $type = $row->type;
        break;
    }

    if ($link && !image_editor_link($link)) {
        $userid = $this->input->post("userid");
        $query = $this->db->where("template_id", $link);
        $query = $this->db->where("user_id", $userid);
        $query = $this->db->get("user_videos");
        $dataCount = $query->num_rows();
        if ($dataCount > 0) {
            $Olddata = $query->row_array();
            $video_id = $Olddata["video_id"];
            // echo $video_id;exit();
            if ($Olddata["video_url"] == null || $Olddata["video_url"] == "") {
                $videoData = $videolink = $pirsonal->Video_Get_Links($video_id);
                // echo $video_id;
                // echo "<pre>";print_r($videoData);exit();
                if (count($videoData) > 0) {
                    $linkUrl = $videoData[0]["url"] ?? null;
                    $udata["video_url"] = $linkUrl;
                    $this->db->where("template_id", $link);
                    $this->db->where("user_id", $userid);
                    $this->db->update("user_videos", $udata);
                } else {
                    echo "Banner not created Yet";
                    exit();
                }
            } else {
                $linkUrl = $Olddata["video_url"];
            }
            if ($linkUrl) {
                banneranalytics($this, $userid, $linkUrl, $link, "VIDEO");
                echo $linkUrl;
                exit();
            }
        }
    }
}
$name = strtoupper($this->input->post("name"));
$phone = $this->input->post("phone");
if (!empty($link) && image_editor_link($link)) {
    $profilePhoto = "";
    if ($type == "IMAGEPROFILE") {
        $query_tile_users = $this->db->get_where("Tile_Users", [
            "user_id" => $userid,
        ]);
        foreach ($query_tile_users->result() as $row) {
            $profilePhoto = $row->profilePhoto;
            break;
        }
    }
    if ($type != "VIDEO" && is_numeric(substr($name, -1))) {
        $name = substr($name, 0, -1);
    }
    $out = image_editor_response_url($link, $type, $name, $phone, $profilePhoto);
    if ($out === null) {
        echo "Banner not created Yet";
        exit();
    }
    banneranalytics($this, $userid, $out, $bannername, $type);
    echo $out;
    exit();
}
if ($type == "VIDEO") {
    $url = "http://quicklook.orientbell.com/PopUpImage/pirsonalvideo/";

    /* Init cURL resource */
    $ch = curl_init($url);

    /* Array Parameter Data */
    $data = ["templateid" => $link, "name" => $name, "phone" => $phone];
    // echo "<pre>";print_r($data);exit();

    /* pass encoded JSON string to the POST fields */
    curl_setopt($ch, CURLOPT_POSTFIELDS, $data);

    /* set the content type json */
    //curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type:application/x-www-form-urlencoded'));

    /* set return type json */
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 0);

    /* execute request */
    $result = curl_exec($ch);

    /* close cURL resource */
    curl_close($ch);

    banneranalytics($this, $userid, $link, $bannername, $type);
} elseif ($type == "IMAGEPROFILE") {
    $query_tile_users = $this->db->get_where("Tile_Users", [
        "user_id" => $userid,
    ]);

    foreach ($query_tile_users->result() as $row) {
        $profilePhoto = $row->profilePhoto;
        break;
    }
    if (is_numeric(substr($name, -1))) {
        $name = substr($name, 0, -1);
    }
    $encoded_name = urlencode($name);
    $imgLink =
        $link .
        "?name=" .
        $encoded_name .
        "&phone=" .
        $phone .
        "&image=" .
        $profilePhoto;

    banneranalytics($this, $userid, $imgLink, $bannername, $type);
    echo $imgLink;
} else {
    if (is_numeric(substr($name, -1))) {
        $name = substr($name, 0, -1);
    }
    $encoded_name = urlencode($name);
    
    ///////////////////////////////// using new branding tool own /////////////////////////////////
    if($link == $thumblink){
        $url = "https://quicklook.orientbell.com/qlbrandingtool/api/brand-image";

        $ch = curl_init($url);

        $data = [
            "image" => $link,
            "dealerName" => $name,
            "phoneNumber" => $phone
        ];

        curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

        $result = curl_exec($ch);
        curl_close($ch);
        
        $response = json_decode($result, true);

        if (!empty($response['success']) && !empty($response['downloadUrl'])) {
            $imgLink = "https://quicklook.orientbell.com/qlbrandingtool/" . $response['downloadUrl'];
        } else {
            $imgLink = $link . "?name=" . $encoded_name . "&phone=" . $phone;
        }
        
    } else{
        $imgLink = $link . "?name=" . $encoded_name . "&phone=" . $phone;
    }

    banneranalytics($this, $userid, $imgLink, $bannername, $type);
    echo $imgLink;
}

function image_editor_link($link)
{
    return is_string($link) && strpos($link, "quicklook.orientbell.com/image-editor/") !== false;
}

function image_editor_is_video($link)
{
    return is_string($link) && strpos($link, "/image-editor/v/") !== false;
}

function image_editor_response_url($link, $type, $name, $phone, $image = null)
{
    if (is_string($link) && strpos($link, "/image-editor/renders/") !== false) {
        return $link;
    }
    if (image_editor_is_video($link) || $type === "VIDEO") {
        return image_editor_video_file_url($link, $name, $phone);
    }
    return image_editor_url($link, $type, $name, $phone, $image);
}

function image_editor_video_file_url($link, $name, $phone)
{
    if (!preg_match('#/image-editor/v/([A-Za-z0-9]+)#', (string) $link, $m)) {
        return null;
    }
    @set_time_limit(300);
    $api = "https://quicklook.orientbell.com/image-editor/api";
    $created = image_editor_rpc($api, "Template_Video_New", [
        "templateID" => $m[1],
        "name" => (string) $name,
        "description" => "",
        "data" => [
            "name" => (string) $name,
            "phone" => (string) $phone,
        ],
    ]);
    $video = image_editor_wait_until_ready($api, $created);
    if (!$video || empty($video["url"])) {
        return null;
    }
    return $video["url"];
}

function image_editor_wait_until_ready($api, $created)
{
    if (!is_array($created) || !empty($created["error"]) || empty($created["result"])) {
        return null;
    }
    $video = $created["result"];
    $code = $video["status"]["code"] ?? "";
    if ($code === "done" && !empty($video["url"])) {
        return $video;
    }
    if ($code === "error" || empty($video["id"])) {
        return null;
    }
    for ($attempt = 0; $attempt < 140; $attempt++) {
        sleep(2);
        $got = image_editor_rpc($api, "Video_Get", ["id" => $video["id"]]);
        if (!is_array($got) || !empty($got["error"]) || empty($got["result"])) {
            continue;
        }
        $video = $got["result"];
        $code = $video["status"]["code"] ?? "";
        if ($code === "done" && !empty($video["url"])) {
            return $video;
        }
        if ($code === "error") {
            return null;
        }
    }
    return null;
}

function image_editor_rpc($url, $method, $params)
{
    $payload = json_encode([
        "jsonrpc" => "2.0",
        "id" => 1,
        "method" => $method,
        "params" => $params,
    ]);
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    $body = curl_exec($ch);
    curl_close($ch);
    $decoded = json_decode($body, true);
    return is_array($decoded) ? $decoded : null;
}

function image_editor_url($link, $type, $name, $phone, $image = null)
{
    $base = "https://quicklook.orientbell.com/image-editor";
    if (!preg_match('#/image-editor/(v/)?([A-Za-z0-9]+)(?:[/?\#]|$)#', $link, $m)) {
        return $link;
    }
    $isVideo = $m[1] === "v/";
    $url = $base . ($isVideo ? "/v/" : "/") . $m[2];
    $url .= "?name=" . urlencode((string) $name) . "&phone=" . urlencode((string) $phone);
    if ($type === "IMAGEPROFILE" && !$isVideo && $image !== null && $image !== "") {
        $url .= "&image=" . urlencode((string) $image);
    }
    return $url;
}

function banneranalytics($self, $userid, $link, $bannername, $type)
{
    $datetoday = date("Y-m-d H:i:s", time());
    $data = [
        "userid" => $userid,
        "BannerLink" => $link,
        "BannerName" => $bannername,
        "timestamp_user" => $datetoday,
        "type" => $type,
    ];
    $self->db->insert("BannerAnalytics", $data);
}

/// เรียก API ระบบหลังบ้าน (dio)
library;

import 'dart:typed_data';

import 'package:dio/dio.dart';

/// ข้อผิดพลาดจาก API — message เป็นภาษาไทยจากเซิร์ฟเวอร์ แสดงให้ผู้ใช้ได้เลย
class ApiException implements Exception {
  ApiException(this.status, this.code, this.message, [this.details]);

  /// 0 = ติดต่อเซิร์ฟเวอร์ไม่ได้ (เน็ตหลุด)
  final int status;
  final String code;
  final String message;
  final dynamic details;

  bool get isNetwork => status == 0;
  bool get isUnauthorized => status == 401;

  /// เซิร์ฟเวอร์ปฏิเสธถาวร (ส่งซ้ำก็ไม่ผ่าน) → ต้องให้ผู้ใช้ดู
  bool get isRejected => status >= 400 && status < 500 && status != 401 && status != 408 && status != 429;

  List<String> get detailMessages {
    final d = details;
    if (d is List) {
      return [for (final x in d) if (x is Map && x['message'] != null) x['message'].toString()];
    }
    return const [];
  }

  @override
  String toString() => message;
}

const defaultApiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:8080/api/v1');

class ApiClient {
  ApiClient({required this.baseUrl, this.token})
      : _dio = Dio(BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 30),
          sendTimeout: const Duration(seconds: 60),
          headers: {if (token != null) 'Authorization': 'Bearer $token'},
        ));

  final String baseUrl;
  final String? token;
  final Dio _dio;

  Map<String, String> get authHeaders => {if (token != null) 'Authorization': 'Bearer $token'};

  String photoUrl(String id) => '$baseUrl/photos/$id';

  Future<T> _wrap<T>(Future<Response<dynamic>> Function() run) async {
    try {
      final res = await run();
      return res.data as T;
    } on DioException catch (e) {
      final res = e.response;
      if (res == null) {
        throw ApiException(0, 'NETWORK', 'ติดต่อเซิร์ฟเวอร์ไม่ได้ (ตรวจอินเทอร์เน็ต)');
      }
      final data = res.data;
      if (data is Map && data['error'] is Map) {
        final err = data['error'] as Map;
        throw ApiException(res.statusCode ?? 500, '${err['code']}', '${err['message']}', err['details']);
      }
      throw ApiException(res.statusCode ?? 500, 'HTTP_${res.statusCode}', 'เซิร์ฟเวอร์ตอบกลับผิดพลาด (${res.statusCode})');
    }
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) => _wrap(() => _dio.get(path, queryParameters: query));

  Future<T> post<T>(String path, [Object? body]) => _wrap(() => _dio.post(path, data: body ?? {}));

  Future<T> put<T>(String path, [Object? body]) => _wrap(() => _dio.put(path, data: body ?? {}));

  Future<T> patch<T>(String path, [Object? body]) => _wrap(() => _dio.patch(path, data: body ?? {}));

  Future<T> send<T>(String method, String path, Object? body) => _wrap(() => _dio.request(
        path,
        data: body,
        options: Options(method: method),
      ));

  Future<void> putBytes(String path, Uint8List bytes, String contentType) => _wrap(() => _dio.put(
        path,
        data: Stream.fromIterable([bytes]),
        options: Options(contentType: contentType, headers: {Headers.contentLengthHeader: bytes.length}),
      ));

  Future<Uint8List> getBytes(String path) async {
    try {
      final res = await _dio.get<List<int>>(path, options: Options(responseType: ResponseType.bytes));
      return Uint8List.fromList(res.data!);
    } on DioException catch (e) {
      throw ApiException(e.response?.statusCode ?? 0, 'PHOTO', 'โหลดรูปไม่ได้');
    }
  }
}

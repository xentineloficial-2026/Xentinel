/// Uses local device time only for a greeting, never for emergency severity.
String greetingFor(String name, DateTime now) {
  final firstName = name.trim().split(RegExp(r'\s+')).first;
  final greeting = now.hour < 12
      ? 'Buenos días'
      : now.hour < 19
      ? 'Buenas tardes'
      : 'Buenas noches';
  return firstName.isEmpty ? greeting : '$greeting, $firstName';
}

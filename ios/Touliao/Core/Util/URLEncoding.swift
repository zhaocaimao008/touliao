import Foundation

extension CharacterSet {
    /// 仅用于 URL query value 的安全字符集（在 urlQueryAllowed 基础上排除 & = ? # +），
    /// 供各 Repository 拼接查询串时对用户输入做百分号编码。
    static let urlQueryValueAllowed: CharacterSet = {
        var cs = CharacterSet.urlQueryAllowed
        cs.remove(charactersIn: "&=?#+")
        return cs
    }()
}

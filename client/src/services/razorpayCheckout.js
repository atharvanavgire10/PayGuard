const scriptUrl = 'https://checkout.razorpay.com/v1/checkout.js'

export function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${scriptUrl}"]`)
    if (existing) { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); return }
    const script = document.createElement('script'); script.src = scriptUrl; script.async = true; script.onload = resolve; script.onerror = reject; document.body.appendChild(script)
  })
}

export function openRazorpayCheckout(options) { return new window.Razorpay(options).open() }
